import { beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, EncryptionKeyMissingError, isEncryptionKeySet } from './crypto.util.js';

const KEY = Buffer.alloc(32, 7).toString('base64'); // 32 bytes determinísticos

describe('crypto.util', () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = KEY;
  });

  it('round-trip: decrypt(encrypt(x)) === x', () => {
    const blob = encrypt('rk_live_segredo');
    expect(blob.startsWith('v1:')).toBe(true);
    expect(decrypt(blob)).toBe('rk_live_segredo');
  });

  it('dois encrypts do mesmo texto geram blobs diferentes (IV aleatório)', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'));
  });

  it('tag adulterada faz o decrypt lançar', () => {
    const blob = encrypt('x');
    const parts = blob.split(':');
    parts[2] = Buffer.alloc(16, 0).toString('base64'); // tag zerada
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('formato inválido lança', () => {
    expect(() => decrypt('naoehblob')).toThrow();
  });

  it('sem APP_ENCRYPTION_KEY: encrypt lança EncryptionKeyMissingError e isEncryptionKeySet=false', () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(isEncryptionKeySet()).toBe(false);
    expect(() => encrypt('x')).toThrow(EncryptionKeyMissingError);
  });
});
