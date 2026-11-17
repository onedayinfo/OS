import { AuthController } from './auth.controller.js';

describe('AuthController.me', () => {
  it('devolve o publicUser do req.user.id', async () => {
    const users = {
      getPublicById: vi.fn().mockResolvedValue({
        id: 'u1',
        name: 'Ana',
        email: 'ana@x.com',
        type: 'INTERNAL',
        role: 'ADMIN',
        clientId: null,
        active: true,
      }),
    };
    const controller = new AuthController({} as any, users as any, { screensFor: vi.fn() } as any);

    const result = await controller.me({
      id: 'u1',
      type: 'INTERNAL',
      role: 'ADMIN',
      clientId: null,
    });

    expect(users.getPublicById).toHaveBeenCalledWith('u1');
    expect(result).toMatchObject({ id: 'u1', email: 'ana@x.com', type: 'INTERNAL' });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('devolve screens do grupo', async () => {
    const users = { getPublicById: vi.fn().mockResolvedValue({ id: 'u1' }) };
    const groups = { screensFor: vi.fn().mockResolvedValue(['crm']) };
    const controller = new AuthController({} as any, users as any, groups as any);

    const result = await controller.me({ id: 'u1', type: 'INTERNAL', role: 'ADMIN', clientId: null });

    expect(groups.screensFor).toHaveBeenCalledWith('u1');
    expect(result).toMatchObject({ id: 'u1', screens: ['crm'] });
  });
});
