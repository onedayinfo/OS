// Sem 'use client': `fetchBranding` roda no server (root layout) e no client;
// `useBranding` só é importado por componentes client.
import { useQuery } from '@tanstack/react-query';

export interface Branding {
  companyName: string | null;
  primaryColor: string | null;
  hasLogo: boolean;
  logoUrl: string;
}

export const DEFAULT_BRANDING: Branding = {
  companyName: null,
  primaryColor: null,
  hasLogo: false,
  logoUrl: '/api/branding/logo',
};

/**
 * Busca a marca. No server usa `BACKEND_INTERNAL_URL` (rede interna do compose);
 * no client vai pelo proxy `/api`. Nunca lança — em erro devolve o default.
 */
export async function fetchBranding(): Promise<Branding> {
  try {
    const base =
      typeof window === 'undefined'
        ? (process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001')
        : '';
    const res = await fetch(`${base}/api/branding`, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_BRANDING;
    return (await res.json()) as Branding;
  } catch {
    return DEFAULT_BRANDING;
  }
}

export function useBranding(): Branding {
  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: fetchBranding,
    initialData: DEFAULT_BRANDING,
    staleTime: 60_000,
  });
  return data;
}
