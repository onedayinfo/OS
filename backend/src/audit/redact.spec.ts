import { describe, expect, it } from 'vitest';
import { limitSize, redact } from './redact.js';

describe('redact', () => {
  it('mascara senha', () => {
    expect(redact({ email: 'a@b', password: 'x' })).toEqual({ email: 'a@b', password: '***' });
  });
  it('mascara chaves com ponto, incluindo accessKeyId (SECRET_KEYS)', () => {
    expect(
      redact({
        values: { 'storage.s3.secretAccessKey': 's', 'storage.s3.accessKeyId': 'AK', 'resend.apiKey': 'k' },
      }),
    ).toEqual({
      values: { 'storage.s3.secretAccessKey': '***', 'storage.s3.accessKeyId': '***', 'resend.apiKey': '***' },
    });
  });
  it('mascara chave de SECRET_KEYS', () => {
    expect(redact({ values: { 'storage.s3.accessKeyId': 'AK' } })).toEqual({ values: { 'storage.s3.accessKeyId': '***' } });
  });
  it('mascara aninhado e em arrays', () => {
    expect(redact([{ token: 't' }])).toEqual([{ token: '***' }]);
    expect(redact({ s3: { secretAccessKey: 'x' } })).toEqual({ s3: { secretAccessKey: '***' } });
  });
  it('converte Date em ISO', () => {
    expect(redact({ d: new Date('2026-01-02T03:04:05.000Z') })).toEqual({ d: '2026-01-02T03:04:05.000Z' });
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
