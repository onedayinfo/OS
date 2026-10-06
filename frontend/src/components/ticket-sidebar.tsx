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
import { Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-0">
      <span className="label-mono text-muted-foreground">{label}</span>
      <span className="text-[13px]">{children}</span>
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
    <div className="rounded-xl bg-warning p-4">
      <p className="text-[13px] font-semibold text-warning-foreground">Chamado em triagem</p>
      <p className="mb-2 text-xs text-warning-foreground">Vincule a um cliente e solicitante.</p>
      <div className="flex flex-col gap-2">
        <Select
          className="h-9 bg-card"
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
          className="h-9 bg-card"
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
    <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
      <Panel title="Cliente e contrato" icon="business">
        <Row label="Cliente">{ticket.client?.name ?? '—'}</Row>
        <Row label="Solicitante">
          {ticket.requester ? `${ticket.requester.name} (${ticket.requester.email})` : '—'}
        </Row>
        <Row label="Contrato">
          {ticket.contract ? (
            <a href={`/app/contratos/${ticket.contract.id}`} className="text-primary underline">
              {ticket.contract.name}
            </a>
          ) : (
            '—'
          )}
        </Row>
        <Row label="Local">{ticket.location?.name ?? '—'}</Row>
        <Row label="Ativos">
          {ticket.assets?.length
            ? ticket.assets.map((a) => (
                <a
                  key={a.id}
                  href={`/app/ativos/${a.id}`}
                  className="mr-2 text-primary underline"
                >
                  {a.label}
                </a>
              ))
            : '—'}
        </Row>
        {ticket.equipment ? (
          <Row label="Equipamento (legado)">{ticket.equipment}</Row>
        ) : null}
      </Panel>

      <Panel title="Detalhes" icon="info">
        <Row label="Categoria">{ticket.category?.name ?? '—'}</Row>
        <Row label="Origem">{ORIGIN_LABELS[ticket.origin]}</Row>
        <Row label="Prioridade">{PRIORITY_LABELS[ticket.priority]}</Row>
        <Row label="Criado em">{fmt(ticket.createdAt)}</Row>
        <Row label="SLA">{fmt(ticket.slaDueAt)}</Row>
        <Row label="Resolvido em">{fmt(ticket.resolvedAt)}</Row>
      </Panel>

      {ticket.needsTriage && <TriageBlock ticket={ticket} />}
    </aside>
  );
}
