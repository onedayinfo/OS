import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { Public } from '../common/public.decorator.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { UsersService } from '../users/users.service.js';
import { SetPasswordDto } from '../users/dto/set-password.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';

const REFRESH_COOKIE = 'refreshToken';

// ponytail: default dev = lax/secure=false (funciona em http://localhost).
// Produção cross-origin: COOKIE_SAMESITE=none + COOKIE_SECURE=true — o navegador
// recusa SameSite=None sem Secure, então 'none' força secure=true aqui.
const rawSameSite = (process.env.COOKIE_SAMESITE ?? 'lax').toLowerCase();
const sameSite: CookieOptions['sameSite'] = (['lax', 'none', 'strict'].includes(rawSameSite)
  ? rawSameSite
  : 'lax') as CookieOptions['sameSite'];
const secure = process.env.COOKIE_SECURE === 'true' || sameSite === 'none';

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite,
  secure,
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// clearCookie precisa dos mesmos path/sameSite/secure, senão o navegador não casa o cookie.
const clearCookieOptions: CookieOptions = { path: '/api/auth', sameSite, secure };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateLogin(dto.email, dto.password);
    const { accessToken, refreshToken } = await this.auth.issueTokens(user);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        role: user.role,
        clientId: user.clientId,
      },
    };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
    const { accessToken, refreshToken } = await this.auth.rotateRefresh(raw);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    return { accessToken };
  }

  @Public()
  @Post('set-password')
  async setPassword(@Body() dto: SetPasswordDto) {
    await this.users.setPassword(dto.token, dto.password);
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.users.forgotPassword(dto.email);
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '');
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions);
    return { ok: true };
  }
}
