import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { UserType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from '../auth/password.util.js';
import type { MailSender } from './mail-sender.js';
import { CreateInternalDto } from './dto/create-internal.dto.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { publicUser, publicUsers } from './user-view.js';
import { normalizePhone } from '../common/phone.util.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { assertFullAdmin } from '../user-groups/assert-full-admin.js';
import { UserGroupsService } from '../user-groups/user-groups.service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class UsersService {
  /** Vazio limpa (null); preenchido mas curto demais é erro, não apagamento silencioso. */
  private phoneOrThrow(raw: string | null | undefined): string | null {
    const p = normalizePhone(raw);
    if (!p && raw && raw.trim()) throw new BadRequestException('Telefone inválido.');
    return p;
  }


  constructor(
    private readonly prisma: PrismaService,
    @Inject('MailSender') private readonly mail: MailSender,
    private readonly groups: UserGroupsService,
  ) {}

  /** Só o admin pleno (sem grupo) atribui/remove grupo; só INTERNAL tem grupo. */
  private async assertCanSetGroup(actor: CurrentUserData, target: { type: string }) {
    await assertFullAdmin(this.groups, actor.id);
    if (target.type !== 'INTERNAL') {
      throw new BadRequestException('Grupos são só para usuários internos.');
    }
  }

  /** FK inexistente (P2003) / registro ausente (P2025) → 400 amigável. */
  private async withGroupCheck<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'P2003' || code === 'P2025') throw new BadRequestException('Grupo não encontrado.');
      throw e;
    }
  }

  /** Uso interno pelo inbound de e-mail (Fase 9) — NÃO é rota; devolve o registro cru. */
  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Usado por `GET /api/auth/me` — hidrata o usuário logado (allowlist). */
  async getPublicById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return publicUser(user);
  }

  async findAll(params: { type?: string; clientId?: string }) {
    const list = await this.prisma.user.findMany({
      where: {
        type: params.type ? (params.type as UserType) : undefined,
        clientId: params.clientId,
      },
      orderBy: { name: 'asc' },
    });
    return publicUsers(list);
  }

  async createInternal(dto: CreateInternalDto, actor: CurrentUserData) {
    if (dto.groupId !== undefined) await this.assertCanSetGroup(actor, { type: 'INTERNAL' });
    // Quem tem grupo não cria admin pleno: o criado herda o grupo do autor.
    const groupId =
      dto.groupId !== undefined
        ? dto.groupId
        : (await this.groups.isFullAdmin(actor.id))
          ? undefined
          : (await this.prisma.user.findUnique({ where: { id: actor.id }, select: { groupId: true } }))?.groupId;
    const passwordHash = await hashPassword(dto.password);
    const user = await this.withGroupCheck(() => this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        role: dto.role,
        type: 'INTERNAL',
        passwordHash,
        active: true,
        groupId,
      },
    }));
    return publicUser(user);
  }

  async createContact(clientId: string, dto: CreateContactDto) {
    const inviteToken = randomBytes(32).toString('hex');
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        role: dto.role,
        type: 'CLIENT',
        clientId,
        phone: this.phoneOrThrow(dto.phone),
        passwordHash: null,
        inviteToken,
        inviteSentAt: new Date(),
      },
    });
    const link = `${process.env.PORTAL_URL}/portal/definir-senha?token=${inviteToken}`;
    await this.mail.sendInvite(user, link);
    return publicUser(user);
  }

  /**
   * "Esqueci a senha": se o e-mail existe e está ativo, gera novo
   * `inviteToken`/`inviteSentAt` e reenvia o convite. Reusa o fluxo de token do
   * convite (`setPassword`). O controller sempre responde 204 — não revela se o
   * e-mail existe. Conta desativada (único offboarding do sistema) não pode
   * pedir redefinição: um ADMIN demitido não volta pelo "esqueci a senha".
   */
  async forgotPassword(email: string): Promise<void> {
    // ponytail: a rota devolve 204 sempre (não vaza existência); o rate limit
    // (@Throttle 5/min em POST /api/auth/forgot-password) é a mitigação. O vetor
    // de enumeração por timing (conta existente faz update + envio de e-mail,
    // inexistente retorna cedo) fica como risco aceito — sem custo de mascarar.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) return;
    const inviteToken = randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { inviteToken, inviteSentAt: new Date() },
    });
    const base =
      user.type === 'INTERNAL'
        ? `${process.env.APP_URL}/app`
        : `${process.env.PORTAL_URL}/portal`;
    await this.mail.sendInvite(user, `${base}/definir-senha?token=${inviteToken}`);
  }

  async setPassword(token: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { inviteToken: token } });
    if (!user || !user.inviteSentAt) {
      throw new BadRequestException('Convite inválido.');
    }
    // Só usuário ativo recebe token legítimo (contatos convidados nascem
    // `active: true`; `forgotPassword` recusa conta desativada). Um contato
    // inbound "não verificado" (`active: false`) que de algum modo tenha token
    // não pode se auto-ativar por aqui.
    if (!user.active) {
      throw new BadRequestException('Convite inválido.');
    }
    if (Date.now() - user.inviteSentAt.getTime() > INVITE_TTL_MS) {
      throw new BadRequestException('Convite expirado.');
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        inviteToken: null,
        inviteSentAt: null,
      },
    });
    return publicUser(updated);
  }

  async update(id: string, dto: UpdateUserDto, actor: CurrentUserData) {
    const found = await this.prisma.user.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Usuário não encontrado.');
    // Admin pleno só é editado por admin pleno (ex.: desativar o dono do sistema).
    if (found.role === 'ADMIN' && !found.groupId) await assertFullAdmin(this.groups, actor.id);
    const data: { name?: string; active?: boolean; phone?: string | null; groupId?: string | null } = {};
    if (dto.groupId !== undefined) {
      await this.assertCanSetGroup(actor, found);
      if (id === actor.id && dto.groupId !== null) {
        throw new ForbiddenException('Você não pode restringir o próprio acesso.');
      }
      data.groupId = dto.groupId;
    }
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.phone !== undefined) data.phone = this.phoneOrThrow(dto.phone);
    const write = () => this.prisma.user.update({ where: { id }, data });
    const updated = await (dto.groupId !== undefined ? this.withGroupCheck(write) : write());
    return publicUser(updated);
  }
}
