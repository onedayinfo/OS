import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';

/** Registra o `RolesGuard` como guard global (roda após o `JwtAuthGuard`). */
@Module({
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class CommonModule {}
