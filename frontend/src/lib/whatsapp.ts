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
  ai: { usedToday: number; limit: number; paused: boolean; lastError: { message: string; at: string } | null };
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
