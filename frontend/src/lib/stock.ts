'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Warehouse {
  id: string;
  name: string;
  active: boolean;
}

export interface StockBalance {
  catalogItemId: string;
  warehouseId: string;
  quantity: number;
  minQuantity: number | null;
  avgCost: number;
  belowMinimum: boolean;
  catalogItem: { id: string; name: string; unit: string };
  warehouse: { id: string; name: string };
}

export function useWarehouses() {
  return useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses') });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Warehouse>('/warehouses', { method: 'POST', body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  });
}

export interface StockBalanceFilters {
  warehouseId?: string;
  catalogItemId?: string;
  belowMinimum?: boolean;
}

function toQuery(f: StockBalanceFilters): string {
  const p = new URLSearchParams();
  if (f.warehouseId) p.set('warehouseId', f.warehouseId);
  if (f.catalogItemId) p.set('catalogItemId', f.catalogItemId);
  if (f.belowMinimum) p.set('belowMinimum', 'true');
  return p.toString();
}

export function useStockBalances(filter: StockBalanceFilters = {}) {
  return useQuery({
    queryKey: ['stock-balances', filter],
    queryFn: () => api<StockBalance[]>(`/stock/balances?${toQuery(filter)}`),
  });
}

export function useUpdateMinQuantity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ catalogItemId, warehouseId, minQuantity }: { catalogItemId: string; warehouseId: string; minQuantity: number | null }) =>
      api(`/stock/balances/${catalogItemId}/${warehouseId}`, { method: 'PATCH', body: { minQuantity } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-balances'] }),
  });
}

export interface StockEntryInput {
  catalogItemId: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
  notes?: string;
}

export function useCreateStockEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StockEntryInput) => api('/stock/entries', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-balances'] }),
  });
}

export interface StockTransferInput {
  catalogItemId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  notes?: string;
}

export function useCreateStockTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StockTransferInput) => api('/stock/transfers', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-balances'] }),
  });
}
