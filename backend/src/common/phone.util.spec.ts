import { normalizePhone, phoneFromJid, phoneKey } from './phone.util.js';

describe('phone.util', () => {
  it('normalizePhone: só dígitos; curto/vazio vira null', () => {
    expect(normalizePhone('+55 (19) 99999-1234')).toBe('5519999991234');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('phoneFromJid: usuário, com sufixo de dispositivo e LID', () => {
    expect(phoneFromJid('5519999991234@s.whatsapp.net')).toBe('5519999991234');
    expect(phoneFromJid('5519999991234:12@s.whatsapp.net')).toBe('5519999991234');
    expect(phoneFromJid('99887766554433@lid')).toBeNull();
    expect(phoneFromJid(null)).toBeNull();
  });

  it('phoneKey: com e sem o 9º dígito geram a mesma chave; números distintos não', () => {
    expect(phoneKey('5519999991234')).toBe(phoneKey('551999991234'));
    expect(phoneKey('5519988887777')).not.toBe(phoneKey('5519999991234'));
    expect(phoneKey('abc')).toBeNull();
  });
});
