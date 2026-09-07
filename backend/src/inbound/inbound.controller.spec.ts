import { createHmac } from 'node:crypto';
import { verifyResendSignature } from './inbound.controller.js';

const SECRET = 'dev-inbound';
const sign = (raw: string) =>
  createHmac('sha256', SECRET).update(Buffer.from(raw)).digest('hex');

describe('verifyResendSignature', () => {
  const OLD = process.env.RESEND_INBOUND_SECRET;
  beforeEach(() => {
    process.env.RESEND_INBOUND_SECRET = SECRET;
  });
  afterAll(() => {
    process.env.RESEND_INBOUND_SECRET = OLD;
  });

  it('assinatura correta → true', () => {
    const raw = '{"a":1}';
    expect(verifyResendSignature(Buffer.from(raw), sign(raw))).toBe(true);
  });

  it('assinatura errada → false', () => {
    expect(verifyResendSignature(Buffer.from('{"a":1}'), 'deadbeef')).toBe(false);
  });

  it('sem header → false', () => {
    expect(verifyResendSignature(Buffer.from('{}'), undefined)).toBe(false);
  });

  it('sem corpo cru → false', () => {
    expect(verifyResendSignature(undefined, sign('{}'))).toBe(false);
  });

  it('fail-closed: sem secret configurado, assinatura não casa → false', () => {
    delete process.env.RESEND_INBOUND_SECRET;
    expect(verifyResendSignature(Buffer.from('{}'), sign('{}'))).toBe(false);
  });
});
