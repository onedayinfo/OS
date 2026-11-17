/**
 * Telas controláveis por grupo de acesso.
 * ponytail: cópia da lista do backend (SCREENS) — mudou lá, muda aqui.
 */
import type { SessionUser } from './auth';

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

export const SCREEN_LABELS: Record<ScreenKey, string> = {
  dashboard: 'Painel',
  agenda: 'Agenda técnica',
  triagem: 'Triagem WhatsApp',
  campo: 'Técnico de campo',
  clientes: 'Clientes',
  ativos: 'Parque de ativos',
  contratos: 'Contratos',
  crm: 'CRM',
  orcamentos: 'Orçamentos',
  catalogo: 'Catálogo de serviços',
  estoque: 'Estoque e peças',
  'base-conhecimento': 'Base de conhecimento',
  config: 'Configurações',
};

/** Tela dona de um caminho (por prefixo). `/app` e `/app/chamados/*` não têm tela. */
export function screenForPath(pathname: string): ScreenKey | null {
  for (const key of SCREENS) {
    const base = `/app/${key}`;
    if (pathname === base || pathname.startsWith(`${base}/`)) return key;
  }
  return null;
}

/** `screens` nulo = sem restrição. */
export function canSee(user: Pick<SessionUser, 'screens'> | null, key: ScreenKey): boolean {
  return !user?.screens || user.screens.includes(key);
}
