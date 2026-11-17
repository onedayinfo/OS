import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScreenGuard } from './screen.guard.js';
import { Screen, SkipScreen } from './screen.decorator.js';

@Screen('crm')
class FakeController {
  protected(): void {}
  @SkipScreen()
  skipped(): void {}
}
class OpenController {
  open(): void {}
}

function ctx(cls: any, method: string, user: any = { id: 'u1' }) {
  return {
    getHandler: () => cls.prototype[method],
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function make(screens: any) {
  const groups = { screensFor: vi.fn().mockResolvedValue(screens) };
  return { groups, guard: new ScreenGuard(new Reflector(), groups as any) };
}

describe('ScreenGuard', () => {
  it('usuário sem grupo (null) passa', async () => {
    const { guard } = make(null);
    await expect(guard.canActivate(ctx(FakeController, 'protected'))).resolves.toBe(true);
  });

  it('grupo sem a tela lança Forbidden', async () => {
    const { guard } = make(['clientes']);
    await expect(guard.canActivate(ctx(FakeController, 'protected'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('grupo com a tela passa', async () => {
    const { guard } = make(['crm']);
    await expect(guard.canActivate(ctx(FakeController, 'protected'))).resolves.toBe(true);
  });

  it('@SkipScreen no método vence a classe', async () => {
    const { guard } = make(['clientes']);
    await expect(guard.canActivate(ctx(FakeController, 'skipped'))).resolves.toBe(true);
  });

  it('sem metadado não consulta o service', async () => {
    const { guard, groups } = make([]);
    await expect(guard.canActivate(ctx(OpenController, 'open'))).resolves.toBe(true);
    expect(groups.screensFor).not.toHaveBeenCalled();
  });

  it('sem req.user passa', async () => {
    const { guard, groups } = make([]);
    await expect(guard.canActivate(ctx(FakeController, 'protected', null))).resolves.toBe(true);
    expect(groups.screensFor).not.toHaveBeenCalled();
  });
});
