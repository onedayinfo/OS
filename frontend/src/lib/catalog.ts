'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type CatalogItemType = 'SERVICE' | 'PRODUCT';

export const CATALOG_ITEM_TYPE_LABELS: Record<CatalogItemType, string> = {
  SERVICE: 'Serviço',
  PRODUCT: 'Produto',
};

export interface CatalogItem {
  id: string;
  name: string;
  type: CatalogItemType;
  unit: string;
  price: number;
  active: boolean;
}

export interface CatalogItemFilters {
  type?: CatalogItemType;
  active?: boolean;
}

function toQuery(f: CatalogItemFilters): string {
  const p = new URLSearchParams();
  if (f.type) p.set('type', f.type);
  if (f.active !== undefined) p.set('active', String(f.active));
  return p.toString();
}

export function useCatalogItems(filter: CatalogItemFilters = {}) {
  return useQuery({
    queryKey: ['catalog-items', filter],
    queryFn: () => api<CatalogItem[]>(`/catalog-items?${toQuery(filter)}`),
  });
}

export interface CatalogItemInput {
  name: string;
  type: CatalogItemType;
  unit: string;
  price: number;
}

export function useCreateCatalogItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CatalogItemInput) => api<CatalogItem>('/catalog-items', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog-items'] }),
  });
}

export function useUpdateCatalogItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CatalogItemInput> & { id: string; active?: boolean }) =>
      api<CatalogItem>(`/catalog-items/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog-items'] }),
  });
}
