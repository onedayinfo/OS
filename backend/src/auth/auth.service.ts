import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { verifyPassword } from './password.util.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface TokenUser {
  id: string;
  type: string;
  role: string;
  clientId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateLogin(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active || !user.passwordHash) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    // Best-effort: registra o último acesso (exposto por `publicUser`). Uma
    // falha aqui não pode barrar o login.
    await this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => {});
    return user;
  }

  async issueTokens(user: TokenUser) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, type: user.type, role: user.role, clientId: user.clientId },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: ACCESS_TTL },
    );
    const refreshToken = randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { accessToken, refreshToken };
  }

  async rotateRefresh(rawToken: string) {
    const row = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!row) {
      throw new UnauthorizedException('Refresh token inválido.');
    }
    if (row.revokedAt) {
      // A linha existe mas já foi rotacionada: replay de um refresh token antigo
      // (token vazado / roubado). Revoga a família inteira do usuário (todos os
      // refresh vivos) e derruba a sessão.
      // ponytail: nuke por userId — uma "família" aqui é um usuário; sem
      // rastrear linhagem de rotação porque não há multi-device separado.
      await this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token inválido.');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      // Expiração natural, ainda não revogado: só recusa, sem nuke de família.
      throw new UnauthorizedException('Refresh token inválido.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Refresh token inválido.');
    }
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(user);
  }

  async logout(rawToken: string): Promise<void> {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
