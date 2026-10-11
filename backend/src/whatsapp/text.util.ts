/** Minúscula, sem acento, espaços colapsados — base da comparação de frases. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A mensagem COMEÇA com a frase (`phraseNorm` já normalizada), em fronteira de palavra?
 * Devolve o resto do texto ORIGINAL (sem a pontuação que sobra depois da frase) ou null.
 */
export function matchStart(body: string, phraseNorm: string): { rest: string } | null {
  if (!phraseNorm) return null;
  const norm = normalizeText(body);
  if (!norm.startsWith(phraseNorm)) return null;
  const next = norm.charAt(phraseNorm.length);
  if (next !== '' && /[\p{L}\p{N}]/u.test(next)) return null;

  // ponytail: acha o prefixo do texto original que normaliza para a frase por tentativa
  // (textos de WhatsApp são curtos); evita mapear índices entre texto original e normalizado.
  let i = 0;
  while (i <= body.length && normalizeText(body.slice(0, i)) !== phraseNorm) i++;
  const rest = i > body.length ? '' : body.slice(i).replace(/^[\s\-–—:,.;!?]+/, '').trim();
  return { rest };
}

const TRIVIAL = new Set([
  'ok', 'okay', 'blz', 'beleza', 'certo', 'combinado', 'valeu', 'vlw', 'obrigado', 'obrigada',
  'obg', 'bom dia', 'boa tarde', 'boa noite', 'sim', 'nao', 'kkk', 'kkkk', 'tmj', 'show', 'top',
]);

/** Mensagens que não valem uma chamada de IA: emoji/pontuação, agradecimento, saudação, menos de 4 letras. */
export function isTrivial(body: string): boolean {
  const n = normalizeText(body)
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return n.length < 4 || TRIVIAL.has(n);
}
