import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { Public } from '../common/public.decorator.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

const REFRESH_COOKIE = 'refreshToken';

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: false, // ponytail: dev; ligar via env quando houver HTTPS
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '');
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  }
}
