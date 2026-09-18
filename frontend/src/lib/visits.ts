'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Attachment } from './tickets';

export type VisitStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  SCHEDULED: 'Agendada',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluída',
  CANCELLED: 'Cancelada',
};

export interface ChecklistTemplateItem {
  id: string;
  label: string;
  order: number;
}

export interface ChecklistTemplate {
  id: string;
  categoryId: string | null;
  name: string;
  active: boolean;
  items: ChecklistTemplateItem[];
}

export interface ChecklistAnswer {
  itemId: string;
  done: boolean;
  note: string | null;
}

export interface Visit {
  id: string;
  status: VisitStatus;
  scheduledStart: string;
  scheduledEnd: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  laborStartAt: string | null;
  laborEndAt: string | null;
  notes: string | null;
  reportSentAt: string | null;
  ticket: { id: string; number: string; title: string; client: { id: string; name: string } | null; location: { id: string; name: string } | null };
  technician: { id: string; name: string };
  checklistTemplate: ChecklistTemplate | null;
  checklistAnswers: ChecklistAnswer[];
  attachments: Attachment[];
}

export interface VisitFilters {
  technicianId?: string;
  date?: string;
  status?: VisitStatus;
  ticketId?: string;
}

function toQuery(f: VisitFilters): string {
  const p = new URLSearchParams();
  if (f.technicianId) p.set('technicianId', f.technicianId);
  if (f.date) p.set('date', f.date);
  if (f.status) p.set('status', f.status);
  if (f.ticketId) p.set('ticketId', f.ticketId);
  return p.toString();
}

export function useVisits(filter: VisitFilters) {
  return useQuery({
    queryKey: ['visits', filter],
    queryFn: () => api<Visit[]>(`/visits?${toQuery(filter)}`),
  });
}

export function useVisit(id: string) {
  return useQuery({
    queryKey: ['visit', id],
    queryFn: () => api<Visit>(`/visits/${id}`),
    enabled: !!id,
  });
}

function useVisitMutation<TArgs, TData = Visit>(id: string | undefined, fn: (args: TArgs) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (id) qc.invalidateQueries({ queryKey: ['visit', id] });
      qc.invalidateQueries({ queryKey: ['visits'] });
    },
  });
}

export function useScheduleVisit() {
  return useVisitMutation<{ ticketId: string; technicianId: string; scheduledStart: string; scheduledEnd: string }>(
    undefined,
    (body) => api('/visits', { method: 'POST', body }),
  );
}

export function useRescheduleVisit(id: string) {
  return useVisitMutation<{ technicianId?: string; scheduledStart?: string; scheduledEnd?: string }>(
    id,
    (body) => api(`/visits/${id}`, { method: 'PATCH', body }),
  );
}

export function useCancelVisit(id: string) {
  return useVisitMutation<void>(id, () => api(`/visits/${id}/cancel`, { method: 'POST' }));
}

export function useCheckIn(id: string) {
  return useVisitMutation<{ lat?: number; lng?: number }>(id, (body) =>
    api(`/visits/${id}/check-in`, { method: 'POST', body }),
  );
}

export function useCheckOut(id: string) {
  return useVisitMutation<{ lat?: number; lng?: number }>(id, (body) =>
    api(`/visits/${id}/check-out`, { method: 'POST', body }),
  );
}

export function useSetLabor(id: string) {
  return useVisitMutation<{ laborStartAt: string; laborEndAt: string }>(id, (body) =>
    api(`/visits/${id}/labor`, { method: 'PATCH', body }),
  );
}

export function useSetChecklist(id: string) {
  return useVisitMutation<{ answers: { itemId: string; done: boolean; note?: string }[] }>(id, (body) =>
    api(`/visits/${id}/checklist`, { method: 'PUT', body }),
  );
}

export function useCloseVisit(id: string) {
  return useVisitMutation<void>(id, () => api(`/visits/${id}/close`, { method: 'POST' }));
}

export function useUploadVisitAttachment(id: string) {
  return useVisitMutation<{ file: File; kind: 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE' }>(
    id,
    ({ file, kind }) => {
      const fd = new FormData();
      fd.append('file', file);
      return api(`/visits/${id}/attachments?kind=${kind}`, { method: 'POST', body: fd });
    },
  );
}
