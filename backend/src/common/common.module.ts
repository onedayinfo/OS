import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { ScreenGuard } from './screen.guard.js';
import { UserGroupsModule } from '../user-groups/user-groups.module.js';

/**
 * Guards globais em ordem determinística: o NestJS executa os `APP_GUARD` na
 * ordem em que aparecem neste array, então `JwtAuthGuard` (popula `req.user`,
 * respeita `@Public()`) roda antes de `RolesGuard` (checa `req.user.role`) e `ScreenGuard` (checa a tela liberada ao grupo).
 * `AuthModule` é importado para garantir a `JwtStrategy` registrada no passport.
 */
@Module({
  imports: [AuthModule, UserGroupsModule],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ScreenGuard },
  ],
})
export class CommonModule {}
