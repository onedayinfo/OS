const PLACEHOLDERS = new Set([
  'to be filled by o.e.m.',
  'default string',
  'system serial number',
  'none',
  'n/a',
  '0',
]);

export function normalizeSerial(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (PLACEHOLDERS.has(s.toLowerCase())) return null;
  if (new Set(s).size === 1) return null; // todos os caracteres iguais
  return s;
}
