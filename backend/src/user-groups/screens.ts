/** Telas que um grupo pode liberar (chaves usadas no menu e nas rotas do front). */
export const SCREENS = [
  'dashboard',
  'agenda',
  'triagem',
  'campo',
  'clientes',
  'ativos',
  'contratos',
  'crm',
  'orcamentos',
  'catalogo',
  'estoque',
  'base-conhecimento',
  'config',
] as const;

export type ScreenKey = (typeof SCREENS)[number];
