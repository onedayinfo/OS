import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CommonModule } from './common.module.js';
import { RolesGuard } from './roles.guard.js';
import { ScreenGuard } from './screen.guard.js';

describe('CommonModule — ordem dos guards globais', () => {
  it('registra JwtAuthGuard antes de RolesGuard e ScreenGuard como APP_GUARD', () => {
    const providers = (Reflect.getMetadata('providers', CommonModule) ?? []) as Array<{
      provide?: unknown;
      useClass?: unknown;
    }>;
    const guards = providers.filter((p) => p.provide === APP_GUARD).map((p) => p.useClass);
    expect(guards).toEqual([JwtAuthGuard, RolesGuard, ScreenGuard]);
  });
});
