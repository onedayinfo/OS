'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Severity = 'alta' | 'media' | 'baixa';

export interface Suggestion {
  rule: string;
  severity: Severity;
  title: string;
  detail: string;
}

export const SEVERITY_LABELS: Record<Severity, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
export const SEVERITY_TONE: Record<Severity, 'red' | 'amber' | 'blue'> = {
  alta: 'red',
  media: 'amber',
  baixa: 'blue',
};

export const RULE_LABELS: Record<string, string> = {
  'ram-baixa': 'Memória RAM baixa',
  hdd: 'Disco do sistema é HDD',
  'disco-cheio': 'Disco do sistema cheio',
  'disco-falha': 'Disco com falha (SMART)',
  'disco-atencao': 'Disco com alerta (SMART)',
  'windows-sem-suporte': 'Windows 10 sem suporte',
  'sem-win11': 'Sem requisitos do Windows 11',
  'equipamento-antigo': 'Equipamento antigo',
};

export interface InventoryDisk {
  nome?: string;
  tamanhoGb?: number;
  tipo?: 'SSD' | 'HDD';
  smart?: 'OK' | 'Atenção' | 'Falha';
  livreGb?: number;
  sistema?: boolean;
}

export interface InventorySpecs {
  cpu?: { nome?: string; nucleos?: number };
  ramGb?: number;
  so?: { edicao?: string; build?: string; versao?: string };
  bios?: { data?: string; versao?: string };
  tpm?: { presente?: boolean; versao?: string };
  secureBoot?: boolean;
  uefi?: boolean;
  discos?: InventoryDisk[];
}

export interface SoftwareItem {
  name: string;
  version?: string | null;
  publisher?: string | null;
}

export interface AssetInventory {
  device: {
    hostname: string;
    agentVersion: string | null;
    firstSeenAt: string;
    lastSeenAt: string | null;
    ip: string | null;
    mac: string | null;
  } | null;
  specs: InventorySpecs | null;
  software: SoftwareItem[];
  suggestions: Suggestion[];
}

export function useAssetInventory(assetId: string) {
  return useQuery({
    queryKey: ['asset-inventory', assetId],
    queryFn: () => api<AssetInventory>(`/assets/${assetId}/inventory`),
  });
}

export interface ImprovementClient {
  clientId: string;
  clientName: string;
  total: number;
  byRule: Record<string, number>;
  items: { assetId: string; label: string; suggestions: Suggestion[] }[];
}

export function useImprovements() {
  return useQuery({
    queryKey: ['agent-improvements'],
    queryFn: () => api<{ clients: ImprovementClient[] }>('/agent/improvements'),
  });
}

/** "há 5 min", "há 3 dias"… */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora há pouco';
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}
