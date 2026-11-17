import { SECRET_KEYS } from '../settings/settings.keys.js';

/** Chave sensível: contém um destes trechos ou termina em `key` (comparação em minúsculas). */
function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    ['password', 'secret', 'token', 'apikey', 'authorization'].some((s) => k.includes(s)) ||
    k.endsWith('key')
  );
}

/** Cópia profunda com valores de chaves sensíveis trocados por '***' e Buffers por '[binary]'. */
export function redact(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return '[binary]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.has(k) || isSecretKey(k) ? '***' : redact(v)]),
    );
  }
  return value;
}

/** Se o JSON passar de `max` caracteres, devolve só um preview truncado. */
export function limitSize(value: unknown, max = 4096): unknown {
  if (value === undefined || value === null) return value;
  const str = JSON.stringify(value);
  return str.length > max ? { _truncated: true, preview: str.slice(0, max) } : value;
}
