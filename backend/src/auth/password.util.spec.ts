import { hashPassword, verifyPassword } from './password.util.js';

it('verifica senha correta e rejeita errada', async () => {
  const h = await hashPassword('segredo123');
  expect(await verifyPassword('segredo123', h)).toBe(true);
  expect(await verifyPassword('errada', h)).toBe(false);
});
