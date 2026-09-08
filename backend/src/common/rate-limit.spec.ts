import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { clientIp } from './rate-limit.js';

describe('clientIp (keyGenerator do rate limit)', () => {
  it('usa CF-Connecting-IP quando presente', () => {
    expect(clientIp({ headers: { 'cf-connecting-ip': '203.0.113.5' } } as unknown as Request)).toBe(
      '203.0.113.5',
    );
  });

  it('sem CF-Connecting-IP, pega o primeiro item de X-Forwarded-For', () => {
    expect(
      clientIp({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } } as unknown as Request),
    ).toBe('203.0.113.9');
  });

  it('sem nenhum header, cai em req.ip', () => {
    expect(clientIp({ ip: '10.1.2.3', headers: {} } as unknown as Request)).toBe('10.1.2.3');
  });
});
