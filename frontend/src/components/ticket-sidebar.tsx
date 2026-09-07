'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import {
  ORIGIN_LABELS,
  PRIORITY_LABELS,
  useTriage,
  type Paged,
  type PublicUser,
  type TicketDetail,
} from '@/lib/tickets';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-0">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function TriageBlock({ ticket }: { ticket: TicketDetail }) {
  const [clientId, setClientId] = useState('');
  const [requesterId, setRequesterId] = useState('');
  const triage = useTriage(ticket.id);

  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });
  const { data: contacts } = useQuery({
    queryKey: ['contacts', clientId],
    queryFn: () => api<PublicUser[]>(`/clients/${clientId}/contacts`),
    enabled: !!clientId,
  });

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-800">Chamado em triagem</p>
      <p className="mb-2 text-xs text-amber-700">Vincule a um cliente e solicitante.</p>
      <div className="flex flex-col gap-2">
        <Select
          className="h-9 bg-background"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setRequesterId('');
          }}
        >
          <option value="">Selecione o cliente</option>
          {clients?.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          className="h-9 bg-background"
          value={requesterId}
          onChange={(e) => setRequesterId(e.target.value)}
          disabled={!clientId}
        >
          <option value="">Selecione o solicitante</option>
          {contacts?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.email})
            </option>
          ))}
        </Select>
        <Button
          className="h-9"
          disabled={!clientId || !requesterId || triage.isPending}
          onClick={() =>
            triage.mutate(
              { clientId, requesterId },
              {
                onSuccess: () => toast.success('Chamado vinculado.'),
                onError: (e) =>
                  toast.error(
                    e instanceof ApiError ? e.message : 'Falha ao vincular o chamado.',
                  ),
              },
            )
          }
        >
          Vincular
        </Button>
      </div>
    </div>
  );
}

export function TicketSidebar({ ticket }: { ticket: TicketDetail }) {
  return (
    <aside className="w-72 shrink-0">
      <div className="rounded-lg border border-border p-4">
        <Row label="Cliente">{ticket.client?.name ?? '—'}</Row>
        <Row label="Solicitante">
          {ticket.requester ? `${ticket.requester.name} (${ticket.requester.email})` : '—'}
        </Row>
        <Row label="Categoria">{ticket.category?.name ?? '—'}</Row>
        <Row label="Origem">{ORIGIN_LABELS[ticket.origin]}</Row>
        <Row label="Prioridade">{PRIORITY_LABELS[ticket.priority]}</Row>
        <Row label="Equipamento">{ticket.equipment ?? '—'}</Row>
        <Row label="Criado em">{fmt(ticket.createdAt)}</Row>
        <Row label="SLA">{fmt(ticket.slaDueAt)}</Row>
        <Row label="Resolvido em">{fmt(ticket.resolvedAt)}</Row>
      </div>
      {ticket.needsTriage && <TriageBlock ticket={ticket} />}
    </aside>
  );
}
