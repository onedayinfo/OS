'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { TicketPriority } from './tickets';

export interface WhatsappGroup {
  id: string;
  externalId: string;
  name: string | null;
  clientId: string;
  active: boolean;
}

export interface TriggerPhrase {
  id: string;
  clientId: string | null;
  phrase: string;
  categoryId: string | null;
  priority: TicketPriority;
  title: string | null;
  active: boolean;
}

export interface Suggestion {
  id: string;
  summary: string;
  excerpt: string;
  urgency: number;
  sentiment: number | null;
  createdAt: string;
  group: { name: string | null; externalId: string };
  client: { id: string; name: string };
}

export interface WhatsappStatus {
  connection: { configured: boolean; state: string; disconnectedSince: string | null };
  ai: {
    day: { tokens: number; costUsd: number };
    month: { tokens: number; costUsd: number };
    limits: { dailyTokens: number; dailyCostUsd: number; monthlyCostUsd: number };
    paused: boolean;
    reason: 'DAILY_TOKENS' | 'DAILY_COST' | 'MONTHLY_COST' | null;
    warn: boolean;
    lastError: { message: string; at: string } | null;
  };
}

export interface TicketWhatsappMessage {
  id: string;
  senderName: string | null;
  senderPhone: string;
  body: string | null;
  sentAt: string;
  group: { name: string | null };
}

// --- grupos ---
export function useGroups(clientId: string) {
  return useQuery({
    queryKey: ['wa-groups', clientId],
    queryFn: () => api<WhatsappGroup[]>(`/whatsapp/groups?clientId=${clientId}`),
  });
}

export function useCreateGroup(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { externalId: string; name?: string }) =>
      api<WhatsappGroup>('/whatsapp/groups', { method: 'POST', body: { clientId, ...body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-groups', clientId] }),
  });
}

export function useUpdateGroup(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; active?: boolean; name?: string }) => {
      const { id, ...body } = v;
      return api<WhatsappGroup>(`/whatsapp/groups/${id}`, { method: 'PATCH', body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-groups', clientId] }),
  });
}

export function useRemoveGroup(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/whatsapp/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-groups', clientId] }),
  });
}

// --- frases ---
export function usePhrases(clientId: string | null) {
  return useQuery({
    queryKey: ['wa-phrases', clientId],
    queryFn: () => api<TriggerPhrase[]>(`/whatsapp/phrases${clientId ? `?clientId=${clientId}` : ''}`),
  });
}

export interface PhraseInput {
  phrase: string;
  categoryId?: string | null;
  priority?: TicketPriority;
  title?: string | null;
  active?: boolean;
}

export function useSavePhrase(clientId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: string } & PhraseInput) => {
      const { id, ...body } = v;
      return id
        ? api<TriggerPhrase>(`/whatsapp/phrases/${id}`, { method: 'PATCH', body })
        : api<TriggerPhrase>('/whatsapp/phrases', {
            method: 'POST',
            body: { ...body, categoryId: body.categoryId || undefined, ...(clientId ? { clientId } : {}) },
          });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-phrases', clientId] }),
  });
}

export function useRemovePhrase(clientId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/whatsapp/phrases/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-phrases', clientId] }),
  });
}

export function useApplyDefaults(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ created: number }>('/whatsapp/phrases/apply-defaults', { method: 'POST', body: { clientId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-phrases', clientId] }),
  });
}

// --- status e triagem ---
export function useWhatsappStatus() {
  return useQuery({
    queryKey: ['wa-status'],
    queryFn: () => api<WhatsappStatus>('/whatsapp/status'),
    refetchInterval: 60_000,
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: ['wa-suggestions'],
    queryFn: () => api<Suggestion[]>('/whatsapp/suggestions'),
    refetchInterval: 30_000,
  });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; title?: string; categoryId?: string }) => {
      const { id, ...body } = v;
      return api<{ id: string; number: string }>(`/whatsapp/suggestions/${id}/accept`, { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-suggestions'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function useDiscardSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/whatsapp/suggestions/${id}/discard`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-suggestions'] }),
  });
}

export function useTicketMessages(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['wa-ticket-messages', ticketId],
    queryFn: () => api<TicketWhatsappMessage[]>(`/whatsapp/messages?ticketId=${ticketId}`),
    enabled,
  });
}

// --- assistente de conexão ---
export interface SetupStep {
  id: 'reachable' | 'instance' | 'webhook' | 'connection';
  label: string;
  status: 'ok' | 'error' | 'pending';
  detail?: string;
}

export interface SetupReport {
  steps: SetupStep[];
  state: string;
  qr: { base64: string | null; pairingCode: string | null } | null;
  config: { urlFromEnv: boolean; apiKeyFromEnv: boolean; instance: string };
}

export function useSetup() {
  return useQuery({
    queryKey: ['wa-setup'],
    queryFn: () => api<SetupReport>('/whatsapp/setup'),
    // enquanto não estiver pareado, acompanha o pareamento
    refetchInterval: (q) => (q.state.data?.state === 'open' ? false : 5000),
  });
}

export function useConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SetupReport>('/whatsapp/connect', { method: 'POST' }),
    onSuccess: (report) => {
      qc.setQueryData(['wa-setup'], report);
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

// --- grupos da Evolution ---
export interface EvolutionGroup {
  id: string;
  name: string;
  size: number | null;
  linkedClientId: string | null;
  linkedClientName: string | null;
}

export interface EvolutionGroupsResponse {
  groups: EvolutionGroup[];
  loading: boolean;
  refreshing: boolean;
  updatedAt: string | null;
  error: string | null;
}

export function useEvolutionGroups(enabled: boolean) {
  return useQuery({
    queryKey: ['wa-evo-groups'],
    queryFn: () => api<EvolutionGroupsResponse>('/whatsapp/evolution/groups'),
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.loading || q.state.data?.refreshing ? 3000 : false),
  });
}

export function useRefreshEvolutionGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<EvolutionGroupsResponse>('/whatsapp/evolution/groups/refresh', { method: 'POST' }),
    onSuccess: (resp) => qc.setQueryData(['wa-evo-groups'], resp),
  });
}

export const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pauseText = (reason: WhatsappStatus['ai']['reason']) =>
  reason === 'MONTHLY_COST' ? 'até o mês que vem' : 'até amanhã';

// --- conversas do dia ---
export interface ConversationMessage {
  id: string;
  senderName: string | null;
  senderPhone: string;
  type: 'TEXT' | 'AUDIO' | 'IMAGE' | 'OTHER';
  body: string | null;
  sentAt: string;
  aiStatus: 'PENDING' | 'ANALYZED' | 'SKIPPED' | 'FAILED';
  ticket: { id: string; number: string } | null;
  suggestion: 'OPEN' | 'ACCEPTED' | 'DISCARDED' | null;
}
export interface ConversationsResponse {
  date: string;
  clients: {
    client: { id: string; name: string };
    total: number;
    groups: { id: string; name: string; messages: ConversationMessage[] }[];
  }[];
}

export function useConversations(date: string) {
  return useQuery({
    queryKey: ['wa-conversations', date],
    queryFn: () => api<ConversationsResponse>(`/whatsapp/messages/conversations?date=${date}`),
    refetchInterval: 30_000,
  });
}
