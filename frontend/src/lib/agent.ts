'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type AgentDeviceStatus = 'PENDING' | 'LINKED' | 'IGNORED';

export const AGENT_STATUS_LABELS: Record<AgentDeviceStatus, string> = {
  PENDING: 'Aguardando cadastro',
  LINKED: 'Vinculado',
  IGNORED: 'Ignorado',
};

export interface AgentDevice {
  id: string;
  clientId: string;
  hostname: string;
  status: AgentDeviceStatus;
  cloneSuspect: boolean;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  ip: string | null;
  mac: string | null;
  lastSeenAt: string | null;
  agentVersion: string | null;
  firstSeenAt: string;
  assetId: string | null;
  client: { id: string; name: string };
  /** só presente para PENDING */
  suggestedAsset?: { id: string; label: string } | null;
}

export interface ClientAgentSummary {
  code: string | null;
  contractValid: boolean;
  counts: { linked: number; pending: number; ignored: number; stale: number };
}

export function useClientAgent(clientId: string) {
  return useQuery({
    queryKey: ['client-agent', clientId],
    queryFn: () => api<ClientAgentSummary>(`/clients/${clientId}/agent`),
  });
}

export function useRegenerateAgentCode(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ code: string }>(`/clients/${clientId}/agent/code`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-agent', clientId] }),
  });
}

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function useAgentDevices(status: AgentDeviceStatus, clientId?: string, pageSize = 100) {
  const p = new URLSearchParams({ status, pageSize: String(pageSize) });
  if (clientId) p.set('clientId', clientId);
  return useQuery({
    queryKey: ['agent-devices', status, clientId ?? '', pageSize],
    queryFn: () => api<Paged<AgentDevice>>(`/agent-devices?${p.toString()}`),
  });
}

/** Total de dispositivos aguardando cadastro (botão da página de ativos). */
export function usePendingAgentCount() {
  return useAgentDevices('PENDING', undefined, 1);
}

export interface ApproveInput {
  locationId: string;
  typeId: string;
  label: string;
  assignedTo?: string;
  description?: string;
  notes?: string;
}

function useDeviceAction<V>(path: (v: V) => string, body?: (v: V) => object) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => api(path(v), { method: 'POST', body: body?.(v) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-devices'] }); // lista + contagem pendente
      qc.invalidateQueries({ queryKey: ['client-agent'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

export const useApproveDevice = () =>
  useDeviceAction<{ id: string } & ApproveInput>(
    (v) => `/agent-devices/${v.id}/approve`,
    ({ id: _id, ...b }) => b,
  );
export const useLinkDevice = () =>
  useDeviceAction<{ id: string; assetId: string }>(
    (v) => `/agent-devices/${v.id}/link`,
    (v) => ({ assetId: v.assetId }),
  );
export const useIgnoreDevice = () => useDeviceAction<string>((id) => `/agent-devices/${id}/ignore`);
export const useRestoreDevice = () => useDeviceAction<string>((id) => `/agent-devices/${id}/restore`);
