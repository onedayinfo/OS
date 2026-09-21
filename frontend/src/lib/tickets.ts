'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, getAccessToken } from './api';

// --- Tipos (espelham o shape real do backend, conferido rodando a API) ---------

export type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_CLIENT'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELLED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketOrigin = 'EMAIL' | 'PORTAL' | 'MANUAL' | 'CONTRACT';
export type CommentVisibility = 'INTERNAL' | 'PUBLIC';

export interface TicketListItem {
  id: string;
  number: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  origin: TicketOrigin;
  needsTriage: boolean;
  slaDueAt: string | null;
  createdAt: string;
  clientId: string | null;
  requesterId: string | null;
  assigneeId: string | null;
  categoryId: string | null;
}

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  type: 'INTERNAL' | 'CLIENT';
  role: string;
  clientId: string | null;
  active: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  kind?: 'GENERIC' | 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE' | 'REPORT';
  visitId?: string | null;
  assetId?: string | null;
}

export interface TicketComment {
  id: string;
  body: string;
  visibility: CommentVisibility;
  authorId: string;
  createdAt: string;
  attachments: Attachment[];
}

export interface TicketEvent {
  id: string;
  type:
    | 'CREATED'
    | 'STATUS_CHANGED'
    | 'ASSIGNED'
    | 'PRIORITY_CHANGED'
    | 'COMMENT'
    | 'EMAIL_IN'
    | 'EMAIL_OUT'
    | 'VISIT_SCHEDULED'
    | 'VISIT_STARTED'
    | 'VISIT_COMPLETED'
    | 'VISIT_CANCELLED';
  data: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
}

export interface TicketDetail extends TicketListItem {
  description: string;
  equipment: string | null;
  location?: { id: string; name: string } | null;
  assets?: { id: string; label: string; type?: { name: string } }[];
  resolvedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
  client: { id: string; name: string } | null;
  requester: PublicUser | null;
  assignee: PublicUser | null;
  category: { id: string; name: string } | null;
  contract?: { id: string; name: string } | null;
  comments: TicketComment[];
  events: TicketEvent[];
  attachments: Attachment[];
  satisfactionSurvey?: { score: number | null; comment: string | null; respondedAt: string | null } | null;
}

// --- Rótulos pt-BR ------------------------------------------------------------

export const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em andamento',
  WAITING_CLIENT: 'Aguardando cliente',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
  CANCELLED: 'Cancelado',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export const ORIGIN_LABELS: Record<TicketOrigin, string> = {
  EMAIL: 'E-mail',
  PORTAL: 'Portal',
  MANUAL: 'Manual',
  CONTRACT: 'Contrato',
};

export const TERMINAL_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED'];

export function isOverdue(t: {
  slaDueAt: string | null;
  status: TicketStatus;
}): boolean {
  return (
    !!t.slaDueAt &&
    new Date(t.slaDueAt).getTime() < Date.now() &&
    !TERMINAL_STATUSES.includes(t.status)
  );
}

// --- Filtros / listagem -----------------------------------------------------

export interface TicketFilters {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: TicketStatus | '';
  priority?: TicketPriority | '';
  categoryId?: string;
  assigneeId?: string;
  clientId?: string;
  overdue?: boolean;
  needsTriage?: boolean;
}

function toQuery(f: TicketFilters): string {
  const p = new URLSearchParams();
  p.set('page', String(f.page ?? 1));
  p.set('pageSize', String(f.pageSize ?? 20));
  if (f.q) p.set('q', f.q);
  if (f.status) p.set('status', f.status);
  if (f.priority) p.set('priority', f.priority);
  if (f.categoryId) p.set('categoryId', f.categoryId);
  if (f.assigneeId) p.set('assigneeId', f.assigneeId);
  if (f.clientId) p.set('clientId', f.clientId);
  if (f.overdue) p.set('overdue', 'true');
  if (f.needsTriage) p.set('needsTriage', 'true');
  return p.toString();
}

export function useTickets(filters: TicketFilters) {
  return useQuery({
    queryKey: ['tickets', filters],
    queryFn: () => api<Paged<TicketListItem>>(`/tickets?${toQuery(filters)}`),
    placeholderData: keepPreviousData,
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api<TicketDetail>(`/tickets/${id}`),
    enabled: !!id,
  });
}

// --- Mutations ------------------------------------------------------------

function useTicketMutation<TArgs, TData = unknown>(
  id: string,
  fn: (args: TArgs) => Promise<TData>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function useChangeStatus(id: string) {
  return useTicketMutation(id, (status: TicketStatus) =>
    api(`/tickets/${id}/status`, { method: 'PATCH', body: { status } }),
  );
}

export function useAssign(id: string) {
  return useTicketMutation(id, (assigneeId: string | null) =>
    api(`/tickets/${id}/assign`, { method: 'PATCH', body: { assigneeId } }),
  );
}

export function useChangePriority(id: string) {
  return useTicketMutation(id, (priority: TicketPriority) =>
    api(`/tickets/${id}/priority`, { method: 'PATCH', body: { priority } }),
  );
}

export function useTriage(id: string) {
  return useTicketMutation(
    id,
    (input: { clientId: string; requesterId: string }) =>
      api(`/tickets/${id}/triage`, { method: 'PATCH', body: input }),
  );
}

export function useAddComment(id: string) {
  return useTicketMutation(
    id,
    (input: { body: string; visibility: CommentVisibility }) =>
      api<TicketComment>(`/tickets/${id}/comments`, { method: 'POST', body: input }),
  );
}

// --- Download autenticado de anexo -----------------------------------------
// GET /api/attachments/:id exige bearer; <a href> não manda header. Busca o blob
// com o token e dispara o download via object URL.
export async function downloadAttachment(id: string, filename: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? '';
  const token = getAccessToken();
  const res = await fetch(`${base}/attachments/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoga fora da pilha atual: alguns navegadores abortam o download se a URL
  // some sincronamente logo após o click().
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
