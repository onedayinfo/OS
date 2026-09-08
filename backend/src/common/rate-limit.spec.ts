import { describe, it, expect, vi, afterEach } from 'vitest';
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { clientIp, rateLimitKey } from './rate-limit.js';

const req = (h: Record<string, string>, ip?: string) =>
  ({ headers: h, ip }) as unknown as Request;

describe('clientIp (string crua do IP)', () => {
  it('usa CF-Connecting-IP quando presente', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.5' }))).toBe('203.0.113.5');
  });

  it('sem CF-Connecting-IP, pega o primeiro item de X-Forwarded-For', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('sem nenhum header, cai em req.ip', () => {
    expect(clientIp(req({}, '10.1.2.3'))).toBe('10.1.2.3');
  });
});

describe('rateLimitKey (keyGenerator do rate limit)', () => {
  it('IPv4 → chave = o próprio IPv4', () => {
    expect(rateLimitKey(req({ 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('dois IPv6 da mesma /56 → mesma chave', () => {
    const a = rateLimitKey(req({ 'cf-connecting-ip': '2001:db8:abcd:1200::1' }));
    const b = rateLimitKey(req({ 'cf-connecting-ip': '2001:db8:abcd:12ff:ffff:ffff:ffff:ffff' }));
    expect(a).toBe(b);
  });

  it('dois IPv6 de /56 diferentes → chaves diferentes', () => {
    const a = rateLimitKey(req({ 'cf-connecting-ip': '2001:db8:abcd:1200::1' }));
    const c = rateLimitKey(req({ 'cf-connecting-ip': '2001:db8:abcd:9900::1' }));
    expect(a).not.toBe(c);
  });

  it('CF-Connecting-IP tem precedência sobre X-Forwarded-For e req.ip', () => {
    expect(
      rateLimitKey(
        req(
          { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1' },
          '10.0.0.1',
        ),
      ),
    ).toBe('203.0.113.5');
  });

  it('string vazia → fallback "unknown"', () => {
    expect(rateLimitKey(req({}, ''))).toBe('unknown');
  });
});

describe('validação do express-rate-limit v8', () => {
  afterEach(() => vi.restoreAllMocks());

  it('não loga console.error/warn de keyGenerator ao processar uma request', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mw = rateLimit({ windowMs: 60_000, max: 10, keyGenerator: rateLimitKey });
    await new Promise<void>((resolve) => {
      mw(
        req({ 'cf-connecting-ip': '2001:db8:abcd:1200::1' }) as never,
        { setHeader: () => {}, getHeader: () => undefined } as never,
        (() => resolve()) as never,
      );
    });
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
