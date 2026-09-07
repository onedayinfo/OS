import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy.validate', () => {
  it('mapeia o payload para o shape do req.user', () => {
    // passport-jwt exige um segredo no construtor.
    process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
    const strategy = new JwtStrategy();
    expect(
      strategy.validate({ sub: 'u1', type: 'INTERNAL', role: 'ADMIN', clientId: null }),
    ).toEqual({ id: 'u1', type: 'INTERNAL', role: 'ADMIN', clientId: null });
  });
});
