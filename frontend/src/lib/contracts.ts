'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type ContractStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
export type FranchiseUnit = 'VISITS' | 'HOURS';

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  ACTIVE: 'Ativo',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
};

export const FRANCHISE_UNIT_LABELS: Record<FranchiseUnit, string> = {
  VISITS: 'visitas/mês',
  HOURS: 'horas/mês',
};

export interface ContractSlaOverride {
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  hours: number;
}

export interface ContractConsumption {
  unit: FranchiseUnit;
  used: number;
  franchiseAmount: number;
  exceeded: boolean;
}

export interface Contract {
  id: string;
  clientId: string;
  client?: { id: string; name: string };
  name: string;
  status: ContractStatus;
  startDate: string;
  endDate: string;
  monthlyValue: number | null;
  franchiseUnit: FranchiseUnit;
  franchiseAmount: number;
  preventiveFrequencyMonths: number | null;
  defaultCategoryId: string | null;
  notes: string | null;
  locations: { id: string; name: string }[];
  assets: { id: string; label: string }[];
  slaOverrides: ContractSlaOverride[];
  consumption: ContractConsumption;
}

export interface ContractFilters {
  clientId?: string;
  status?: ContractStatus;
}

function toQuery(f: ContractFilters): string {
  const p = new URLSearchParams();
  if (f.clientId) p.set('clientId', f.clientId);
  if (f.status) p.set('status', f.status);
  return p.toString();
}

export function useContracts(filter: ContractFilters) {
  return useQuery({
    queryKey: ['contracts', filter],
    queryFn: () => api<Contract[]>(`/contracts?${toQuery(filter)}`),
  });
}

export function useContract(id: string) {
  return useQuery({
    queryKey: ['contract', id],
    queryFn: () => api<Contract>(`/contracts/${id}`),
    enabled: !!id,
  });
}

export interface ContractInput {
  clientId: string;
  name: string;
  startDate: string;
  endDate: string;
  monthlyValue?: number;
  franchiseUnit: FranchiseUnit;
  franchiseAmount: number;
  preventiveFrequencyMonths?: number;
  defaultCategoryId?: string;
  notes?: string;
  locationIds?: string[];
  assetIds?: string[];
  slaOverrides?: ContractSlaOverride[];
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContractInput) => api<Contract>('/contracts', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contracts'] }),
  });
}

export function useUpdateContract(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ContractInput>) => api<Contract>(`/contracts/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract', id] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

export function useCancelContract(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Contract>(`/contracts/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract', id] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}
