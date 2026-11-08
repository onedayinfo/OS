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
