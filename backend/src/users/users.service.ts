import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { UserType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from '../auth/password.util.js';
import type { MailSender } from './mail-sender.js';
import { CreateInternalDto } from './dto/create-internal.dto.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { publicUser, publicUsers } from './user-view.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('MailSender') private readonly mail: MailSender,
  ) {}

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

  async createInternal(dto: CreateInternalDto) {
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        role: dto.role,
        type: 'INTERNAL',
        passwordHash: await hashPassword(dto.password),
        active: true,
      },
    });
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
   * "Esqueci a senha": se o e-mail existe, gera novo `inviteToken`/`inviteSentAt`
   * e reenvia o convite. Reusa o fluxo de token do convite (`setPassword`).
   * O controller sempre responde 204 — não revela se o e-mail existe.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
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
    if (Date.now() - user.inviteSentAt.getTime() > INVITE_TTL_MS) {
      throw new BadRequestException('Convite expirado.');
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        active: true,
        inviteToken: null,
        inviteSentAt: null,
      },
    });
    return publicUser(updated);
  }

  async update(id: string, dto: UpdateUserDto) {
    const found = await this.prisma.user.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Usuário não encontrado.');
    const data: { name?: string; active?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.active !== undefined) data.active = dto.active;
    const updated = await this.prisma.user.update({ where: { id }, data });
    return publicUser(updated);
  }
}
