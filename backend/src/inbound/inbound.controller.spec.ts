import { createHmac } from 'node:crypto';
import { verifyResendSignature } from './inbound.controller.js';

const SECRET = 'dev-inbound';
const sign = (raw: string) =>
  createHmac('sha256', SECRET).update(Buffer.from(raw)).digest('hex');

describe('verifyResendSignature', () => {
  it('assinatura correta → true', () => {
    const raw = '{"a":1}';
    expect(verifyResendSignature(Buffer.from(raw), sign(raw), SECRET)).toBe(true);
  });

  it('assinatura errada → false', () => {
    expect(verifyResendSignature(Buffer.from('{"a":1}'), 'deadbeef', SECRET)).toBe(false);
  });

  it('sem header → false', () => {
    expect(verifyResendSignature(Buffer.from('{}'), undefined, SECRET)).toBe(false);
  });

  it('sem corpo cru → false', () => {
    expect(verifyResendSignature(undefined, sign('{}'), SECRET)).toBe(false);
  });

  it('fail-closed: secret vazio, assinatura não casa → false', () => {
    expect(verifyResendSignature(Buffer.from('{}'), sign('{}'), '')).toBe(false);
  });
});
