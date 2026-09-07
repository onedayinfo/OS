import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma, UserType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from '../auth/password.util.js';
import type { MailSender } from './mail-sender.js';
import { CreateInternalDto } from './dto/create-internal.dto.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('MailSender') private readonly mail: MailSender,
  ) {}

  /** Usado pelo inbound de e-mail (Fase 9). */
  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findAll(params: { type?: string; clientId?: string }) {
    return this.prisma.user.findMany({
      where: {
        type: params.type ? (params.type as UserType) : undefined,
        clientId: params.clientId,
      },
      orderBy: { name: 'asc' },
    });
  }

  async createInternal(dto: CreateInternalDto) {
    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        role: dto.role,
        type: 'INTERNAL',
        passwordHash: await hashPassword(dto.password),
        active: true,
      },
    });
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
    const link = `${process.env.PORTAL_URL}/definir-senha?token=${inviteToken}`;
    await this.mail.sendInvite(user, link);
    return user;
  }

  async setPassword(token: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { inviteToken: token } });
    if (!user || !user.inviteSentAt) {
      throw new BadRequestException('Convite inválido.');
    }
    if (Date.now() - user.inviteSentAt.getTime() > INVITE_TTL_MS) {
      throw new BadRequestException('Convite expirado.');
    }
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        active: true,
        inviteToken: null,
        inviteSentAt: null,
      },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const found = await this.prisma.user.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Usuário não encontrado.');
    return this.prisma.user.update({ where: { id }, data: dto as Prisma.UserUpdateInput });
  }
}
