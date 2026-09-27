'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type OpportunityStage = 'NEW' | 'CONTACTED' | 'PROPOSAL' | 'WON' | 'LOST';

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  NEW: 'Novo',
  CONTACTED: 'Contato feito',
  PROPOSAL: 'Proposta',
  WON: 'Ganho',
  LOST: 'Perdido',
};

export const OPEN_STAGES: OpportunityStage[] = ['NEW', 'CONTACTED', 'PROPOSAL'];

export interface OpportunityNote {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
}

export interface Opportunity {
  id: string;
  title: string;
  stage: OpportunityStage;
  value: number | null;
  clientId: string | null;
  client?: { id: string; name: string } | null;
  leadName: string | null;
  leadCompany: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
  ownerId: string;
  owner?: { id: string; name: string };
  quoteId: string | null;
  quote?: { id: string; number: number; total: number } | null;
  lostReason: string | null;
  nextFollowUpAt: string | null;
  nextFollowUpNote: string | null;
  wonAt: string | null;
  lostAt: string | null;
  notes?: OpportunityNote[];
}

export interface FollowUpItem {
  id: string;
  title: string;
  clientId: string | null;
  client?: { id: string; name: string } | null;
  leadName: string | null;
  ownerId: string;
  nextFollowUpAt: string;
  nextFollowUpNote: string | null;
}

export interface OpportunityFilters {
  stage?: OpportunityStage;
  ownerId?: string;
  clientId?: string;
}

function toQuery(f: OpportunityFilters): string {
  const p = new URLSearchParams();
  if (f.stage) p.set('stage', f.stage);
  if (f.ownerId) p.set('ownerId', f.ownerId);
  if (f.clientId) p.set('clientId', f.clientId);
  return p.toString();
}

export function useOpportunities(filter: OpportunityFilters = {}) {
  return useQuery({
    queryKey: ['opportunities', filter],
    queryFn: () => api<Opportunity[]>(`/opportunities?${toQuery(filter)}`),
  });
}

export function useOpportunity(id: string) {
  return useQuery({
    queryKey: ['opportunity', id],
    queryFn: () => api<Opportunity>(`/opportunities/${id}`),
    enabled: !!id,
  });
}

export function useFollowUps(scope: 'today' | 'overdue') {
  return useQuery({
    queryKey: ['opportunities', 'follow-ups', scope],
    queryFn: () => api<FollowUpItem[]>(`/opportunities/follow-ups?scope=${scope}`),
  });
}

export interface OpportunityInput {
  title: string;
  value?: number;
  ownerId: string;
  clientId?: string;
  leadName?: string;
  leadCompany?: string;
  leadPhone?: string;
  leadEmail?: string;
  quoteId?: string;
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ['opportunities'] });
  if (id) qc.invalidateQueries({ queryKey: ['opportunity', id] });
}

export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OpportunityInput) => api<Opportunity>('/opportunities', { method: 'POST', body }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateOpportunity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<OpportunityInput> & { nextFollowUpAt?: string | null; nextFollowUpNote?: string | null }) =>
      api<Opportunity>(`/opportunities/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidateAll(qc, id),
  });
}

export function useChangeStage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { stage: OpportunityStage; lostReason?: string }) =>
      api<Opportunity>(`/opportunities/${id}/stage`, { method: 'PATCH', body }),
    onSuccess: () => invalidateAll(qc, id),
  });
}

export function useAddNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api<OpportunityNote>(`/opportunities/${id}/notes`, { method: 'POST', body: { text } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity', id] }),
  });
}

export function useRemoveOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/opportunities/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  });
}
