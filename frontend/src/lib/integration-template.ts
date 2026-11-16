/**
 * Pré-visualização do construtor de eventos.
 * ponytail: cópia de `backend/src/integrations/template.util.ts` (getPath/renderTemplate) —
 * mudou lá, muda aqui.
 */

const MARKER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

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

/** Lista plana `caminho → valor` das folhas do JSON (para clicar e inserir `{{caminho}}`). */
export function flattenPaths(value: unknown, prefix = ''): { path: string; value: string }[] {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    if (!entries.length) return prefix ? [{ path: prefix, value: Array.isArray(value) ? '[]' : '{}' }] : [];
    return entries.flatMap(([k, v]) => flattenPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return prefix ? [{ path: prefix, value: value === null ? 'null' : String(value) }] : [];
}
