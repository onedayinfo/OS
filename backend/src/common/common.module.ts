import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

/**
 * Guards globais em ordem determinística: o NestJS executa os `APP_GUARD` na
 * ordem em que aparecem neste array, então `JwtAuthGuard` (popula `req.user`,
 * respeita `@Public()`) roda antes de `RolesGuard` (checa `req.user.role`).
 * `AuthModule` é importado para garantir a `JwtStrategy` registrada no passport.
 */
@Module({
  imports: [AuthModule],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class CommonModule {}
