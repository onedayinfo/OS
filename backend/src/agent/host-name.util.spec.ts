import { hostParaNome } from './host-name.util.js';

describe('hostParaNome', () => {
  afterEach(() => delete process.env.PUBLIC_HOST);

  it('host válido em minúsculas', () => expect(hostParaNome(undefined, 'OS.Cliente.com.br')).toBe('os.cliente.com.br'));
  it('remove a porta', () => expect(hostParaNome(undefined, 'os.cliente.com.br:8443')).toBe('os.cliente.com.br'));
  it('localhost vale sem ponto', () => expect(hostParaNome(undefined, 'localhost:3000')).toBe('localhost'));
  it('X-Forwarded-Host vence Host e usa o primeiro valor', () =>
    expect(hostParaNome('a.cliente.com.br, b.proxy.local', 'interno')).toBe('a.cliente.com.br'));
  it('inválido ou ausente -> undefined', () => {
    expect(hostParaNome(undefined, undefined)).toBeUndefined();
    expect(hostParaNome(undefined, 'backend')).toBeUndefined(); // sem ponto
    expect(hostParaNome(undefined, 'a/b.com')).toBeUndefined();
    expect(hostParaNome(undefined, '-x.com')).toBeUndefined();
    expect(hostParaNome(undefined, '../x.com')).toBeUndefined();
  });
  it('PUBLIC_HOST vence os cabeçalhos', () => {
    process.env.PUBLIC_HOST = 'Os.Fixo.com.br';
    expect(hostParaNome('a.cliente.com.br', 'b.com')).toBe('os.fixo.com.br');
  });
});
