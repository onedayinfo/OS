import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ENV = 'APP_ENCRYPTION_KEY';
const ALGO = 'aes-256-gcm';

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(`Defina ${ENV} (base64 de 32 bytes) para gravar segredos nas configurações.`);
    this.name = 'EncryptionKeyMissingError';
  }
}

function key(): Buffer {
  const raw = process.env[ENV];
  if (!raw) throw new EncryptionKeyMissingError();
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`${ENV} deve ser base64 de exatamente 32 bytes (recebido ${buf.length}).`);
  }
  return buf;
}

export function isEncryptionKeySet(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** `plain` -> `v1:<ivB64>:<tagB64>:<ctB64>` */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(blob: string): string {
  const [v, ivB64, tagB64, ctB64] = blob.split(':');
  if (v !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Blob criptografado em formato inválido.');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Self-check executável: `tsx src/settings/crypto.util.ts` */
export function demo(): void {
  process.env[ENV] ??= Buffer.alloc(32, 1).toString('base64');
  const blob = encrypt('segredo-demo');
  if (decrypt(blob) !== 'segredo-demo') throw new Error('round-trip falhou');
  const bad = blob.split(':');
  bad[3] = Buffer.from('outro').toString('base64');
  try {
    decrypt(bad.join(':'));
    throw new Error('adulteração não detectada');
  } catch {
    /* esperado */
  }
  console.log('crypto.util demo OK');
}

if (import.meta.url === `file://${process.argv[1]}`) demo();
