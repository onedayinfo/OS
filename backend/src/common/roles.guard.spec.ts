import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';

function context(user: unknown) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function guardWithRoles(roles: string[] | undefined) {
  const reflector = { getAllAndOverride: () => roles } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('libera rota sem @Roles', () => {
    expect(guardWithRoles(undefined).canActivate(context({ role: 'AGENT' }))).toBe(true);
  });

  it('bloqueia role fora da lista', () => {
    expect(guardWithRoles(['ADMIN']).canActivate(context({ role: 'AGENT' }))).toBe(false);
  });

  it('libera role na lista', () => {
    expect(guardWithRoles(['ADMIN', 'MANAGER']).canActivate(context({ role: 'MANAGER' }))).toBe(true);
  });

  it('bloqueia quando não há req.user', () => {
    expect(guardWithRoles(['ADMIN']).canActivate(context(undefined))).toBe(false);
  });
});
