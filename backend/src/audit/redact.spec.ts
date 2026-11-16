import { describe, expect, it } from 'vitest';
import { limitSize, redact } from './redact.js';

describe('redact', () => {
  it('mascara senha', () => {
    expect(redact({ email: 'a@b', password: 'x' })).toEqual({ email: 'a@b', password: '***' });
  });
  it('mascara chaves com ponto, preservando accessKeyId', () => {
    expect(
      redact({
        values: { 'storage.s3.secretAccessKey': 's', 'storage.s3.accessKeyId': 'AK', 'resend.apiKey': 'k' },
      }),
    ).toEqual({
      values: { 'storage.s3.secretAccessKey': '***', 'storage.s3.accessKeyId': 'AK', 'resend.apiKey': '***' },
    });
  });
  it('mascara aninhado e em arrays', () => {
    expect(redact([{ token: 't' }])).toEqual([{ token: '***' }]);
    expect(redact({ s3: { secretAccessKey: 'x' } })).toEqual({ s3: { secretAccessKey: '***' } });
  });
  it('substitui buffers', () => {
    expect(redact({ f: Buffer.from('x') })).toEqual({ f: '[binary]' });
  });
});

describe('limitSize', () => {
  it('trunca acima do limite', () => {
    expect(limitSize({ s: 'x'.repeat(5000) })).toMatchObject({ _truncated: true });
  });
  it('mantém valores pequenos e nulos', () => {
    expect(limitSize({ a: 1 })).toEqual({ a: 1 });
    expect(limitSize(undefined)).toBeUndefined();
    expect(limitSize(null)).toBeNull();
  });
});
