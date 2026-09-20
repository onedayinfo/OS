'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type QuoteStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  SUPERSEDED: 'Substituído',
};

export interface QuoteItem {
  catalogItemId: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  catalogItem: { id: string; name: string; unit: string };
}

export interface Quote {
  id: string;
  number: number;
  version: number;
  status: QuoteStatus;
  publicToken: string;
  clientId: string;
  client?: { id: string; name: string };
  ticketId: string | null;
  ticket?: { id: string; number: string } | null;
  categoryId: string | null;
  title: string | null;
  notes: string | null;
  items: QuoteItem[];
  total: number;
}

export interface QuoteFilters {
  clientId?: string;
  ticketId?: string;
  status?: QuoteStatus;
}

function toQuery(f: QuoteFilters): string {
  const p = new URLSearchParams();
  if (f.clientId) p.set('clientId', f.clientId);
  if (f.ticketId) p.set('ticketId', f.ticketId);
  if (f.status) p.set('status', f.status);
  return p.toString();
}

export function useQuotes(filter: QuoteFilters = {}) {
  return useQuery({ queryKey: ['quotes', filter], queryFn: () => api<Quote[]>(`/quotes?${toQuery(filter)}`) });
}

export function useQuote(id: string) {
  return useQuery({ queryKey: ['quote', id], queryFn: () => api<Quote>(`/quotes/${id}`), enabled: !!id });
}

export interface QuoteItemInput {
  catalogItemId: string;
  quantity: number;
  unitPrice?: number;
  description?: string;
}

export interface QuoteInput {
  clientId: string;
  ticketId?: string;
  categoryId?: string;
  title?: string;
  notes?: string;
  items: QuoteItemInput[];
}

export function useCreateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuoteInput) => api<Quote>('/quotes', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });
}

export function useSendQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Quote>(`/quotes/${id}/send`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quote', id] });
    },
  });
}

export function useReviseQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Quote>(`/quotes/${id}/revise`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });
}
