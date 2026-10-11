/** Só dígitos. Menos de 8 dígitos não é telefone → null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

/** "5519999991234@s.whatsapp.net" (com ou sem ":dispositivo") → "5519999991234". LID não carrega telefone → null. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid || jid.endsWith('@lid')) return null;
  return normalizePhone(jid.split('@')[0]?.split(':')[0]);
}

/**
 * Chave de comparação: os 8 últimos dígitos. Cobre o 9º dígito de celular (JIDs de
 * contas antigas vêm sem ele) sem confundir contatos do mesmo cliente.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const p = normalizePhone(phone);
  return p ? p.slice(-8) : null;
}
