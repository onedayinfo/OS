/**
 * Limpeza básica de corpo de e-mail recebido (spec §6.1 passo 7).
 * Sem parser de MIME: o payload do Resend já vem com `text` puro.
 */

// Marcadores comuns de início de citação. O texto útil é tudo ACIMA do primeiro
// marcador encontrado.
const QUOTE_MARKERS: RegExp[] = [
  /^Em .+ escreveu:$/m,
  /^On .+ wrote:$/m,
  /^-----Original Message-----$/m,
  // Separador de underscores do Outlook — o comprimento varia entre versões.
  /^_{5,}$/m,
];

/**
 * Remove linhas iniciadas por `>` e tudo a partir do primeiro marcador de
 * citação (`Em ... escreveu:`, `On ... wrote:`, etc.). Preserva o texto do topo.
 */
export function stripQuotedText(text: string): string {
  if (!text) return '';

  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }

  return text
    .slice(0, cut)
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('>'))
    .join('\n')
    .trim();
}
