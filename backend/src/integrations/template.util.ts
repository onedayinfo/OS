/**
 * Modelos com marcadores `{{a.b.0.c}}` resolvidos contra o JSON recebido.
 * ponytail: a mesma lógica existe em `frontend/src/lib/integration-template.ts`
 * (pré-visualização ao vivo) — mudou aqui, muda lá.
 */

const MARKER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Valor no caminho `a.b.0.c` (índice numérico em listas); `undefined` se não existir. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Troca cada `{{caminho}}` pelo valor; ausente → vazio; objeto/lista → JSON compacto.
 * Se o modelo tem marcadores e nenhum resolve, o resultado é vazio (só texto fixo não conta).
 */
export function renderTemplate(tpl: string | null | undefined, payload: unknown): string {
  if (!tpl) return '';
  let markers = 0;
  let found = 0;
  const out = tpl.replace(MARKER, (_, path: string) => {
    markers++;
    const v = getPath(payload, path);
    if (v === undefined || v === null || v === '') return '';
    found++;
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
  // Modelo com marcadores e nenhum achou dado → evento de outro formato: vazio, não "UniFi:  ()".
  return markers && !found ? '' : out.trim();
}

/** Cópia do JSON com strings longas cortadas (ex.: miniatura base64) para guardar como exemplo. */
export function truncateStrings(value: unknown, max = 500): unknown {
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}… [${value.length} caracteres]` : value;
  }
  if (Array.isArray(value)) return value.map((v) => truncateStrings(v, max));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, truncateStrings(v, max)]),
    );
  }
  return value;
}
