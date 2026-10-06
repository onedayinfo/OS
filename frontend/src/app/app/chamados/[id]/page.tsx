'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TERMINAL_STATUSES,
  downloadAttachment,
  isOverdue,
  useAssign,
  useChangePriority,
  useChangeStatus,
  useTicket,
  type Paged,
  type PublicUser,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/tickets';
import { type Asset } from '@/lib/assets';
import { VISIT_STATUS_LABELS, useVisits } from '@/lib/visits';
import { CommentBox } from '@/components/comment-box';
import { TicketSidebar } from '@/components/ticket-sidebar';
import { TicketTimeline } from '@/components/ticket-timeline';
import { TicketMaterialUsages } from '@/components/ticket-material-usages';
import { TicketQuotes } from '@/components/ticket-quotes';
import { TicketSatisfaction } from '@/components/ticket-satisfaction';
import { KnowledgeSuggestions } from '@/components/knowledge-suggestions';
import { SlaIndicator } from '@/components/sla-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

function AssetsEditPanel({ ticket }: { ticket: TicketDetail }) {
  const qc = useQueryClient();
  const clientId = ticket.clientId ?? '';
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState(ticket.location?.id ?? '');
  const [assetIds, setAssetIds] = useState<string[]>(
    ticket.assets?.map((a) => a.id) ?? [],
  );
  const [busy, setBusy] = useState(false);

  const { data: locations } = useQuery({
    queryKey: ['locations', clientId],
    queryFn: () =>
      api<Paged<{ id: string; name: string }>>(
        `/locations?clientId=${clientId}&pageSize=100`,
      ),
    enabled: !!clientId,
  });
  const { data: assets } = useQuery({
    queryKey: ['assets', locationId],
    queryFn: () => api<Paged<Asset>>(`/assets?locationId=${locationId}&pageSize=100`),
    enabled: !!locationId,
  });

  function reset() {
    setLocationId(ticket.location?.id ?? '');
    setAssetIds(ticket.assets?.map((a) => a.id) ?? []);
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/tickets/${ticket.id}/assets`, {
        method: 'PATCH',
        body: { locationId: locationId || null, assetIds },
      });
      await qc.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      toast.success('Local e ativos atualizados.');
      setOpen(false);
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        className="h-9 self-start"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Editar local/ativos
      </Button>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card p-5 shadow-sm">
      <h2 className="text-[14px] font-semibold">Local e ativos</h2>
      <div className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Local</span>
        <Select
          className="h-9"
          value={locationId}
          disabled={!clientId}
          onChange={(e) => {
            setLocationId(e.target.value);
            setAssetIds([]);
          }}
        >
          <option value="">Nenhum</option>
          {locations?.data.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Ativos</span>
        {!locationId ? (
          <p className="text-sm text-muted-foreground">Selecione um local.</p>
        ) : assets?.data.length ? (
          <div className="flex flex-col gap-1 rounded-lg border border-input p-2">
            {assets.data.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assetIds.includes(a.id)}
                  onChange={(e) =>
                    setAssetIds((prev) =>
                      e.target.checked
                        ? [...prev, a.id]
                        : prev.filter((x) => x !== a.id),
                    )
                  }
                />
                {a.label}
                {a.type?.name ? (
                  <span className="text-muted-foreground">({a.type.name})</span>
                ) : null}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum ativo neste local.</p>
        )}
      </div>
      <div className="flex gap-2">
        <Button className="h-9" disabled={busy} onClick={save}>
          {busy ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button
          variant="outline"
          className="h-9"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancelar
        </Button>
      </div>
    </section>
  );
}

function VisitsBlock({ ticketId }: { ticketId: string }) {
  const { data: visits } = useVisits({ ticketId });
  if (!visits || visits.length === 0) return null;
  return (
    <section className="rounded-xl bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-[14px] font-semibold">Visitas</h2>
      <ul className="flex flex-col gap-1">
        {visits.map((v) => (
          <li key={v.id} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[13px]">
            <span>{new Date(v.scheduledStart).toLocaleString('pt-BR')}</span>
            <span className="text-muted-foreground">{v.technician.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{VISIT_STATUS_LABELS[v.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS_TONE = {
  OPEN: 'blue',
  IN_PROGRESS: 'blue',
  WAITING_CLIENT: 'amber',
  RESOLVED: 'green',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
} as const;

export default function TicketDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data: ticket, isLoading, isError } = useTicket(id);
  const { data: agents } = useQuery({
    queryKey: ['users', 'INTERNAL'],
    queryFn: () => api<PublicUser[]>('/users?type=INTERNAL'),
  });

  const changeStatus = useChangeStatus(id);
  const changePriority = useChangePriority(id);
  const assign = useAssign(id);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !ticket)
    return <p className="text-sm text-destructive-foreground">Chamado não encontrado.</p>;

  const terminal = TERMINAL_STATUSES.includes(ticket.status);
  const late = isOverdue(ticket);

  function setStatus(status: TicketStatus, okMsg: string) {
    changeStatus.mutate(status, { onSuccess: () => toast.success(okMsg), onError: onErr });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <nav className="flex items-center gap-1 text-[12px] text-muted-foreground">
          <Link href="/app" className="hover:text-foreground">
            Chamados / OS
          </Link>
          <Icon name="chevron_right" className="text-[16px]" />
          <span>{ticket.number}</span>
        </nav>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="label-mono rounded bg-info px-2 py-1 font-mono text-info-foreground">
                {ticket.number}
              </p>
              <Badge
                tone={ticket.priority === 'URGENT' || ticket.priority === 'HIGH' ? 'red' : 'neutral'}
                dot={ticket.priority === 'URGENT' || ticket.priority === 'HIGH'}
                className={ticket.priority === 'URGENT' ? 'bg-destructive-foreground text-white' : undefined}
              >
                Prioridade {PRIORITY_LABELS[ticket.priority]}
              </Badge>
              <Badge tone={STATUS_TONE[ticket.status]} dot>
                {STATUS_LABELS[ticket.status]}
              </Badge>
              {late && <Badge tone="red">vencido</Badge>}
              <span className="rounded bg-muted px-2 py-1 text-[12px]">
                <SlaIndicator slaDueAt={ticket.slaDueAt} status={ticket.status} />
              </span>
            </div>
            <h1 className="text-[24px] font-semibold leading-8">{ticket.title}</h1>
          </div>

          {!terminal && (
            <div className="flex flex-wrap gap-2">
              {ticket.status === 'OPEN' && (
                <Button
                  variant="outline"
                  className="flex items-center gap-1.5"
                  onClick={() => setStatus('IN_PROGRESS', 'Atendimento iniciado.')}
                >
                  <Icon name="play_arrow" className="text-[18px]" />
                  Iniciar atendimento
                </Button>
              )}
              {(ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS') && (
                <Button
                  variant="outline"
                  className="flex items-center gap-1.5"
                  onClick={() => setStatus('WAITING_CLIENT', 'Aguardando cliente (SLA pausado).')}
                >
                  <Icon name="pause" className="text-[18px]" />
                  Aguardar cliente
                </Button>
              )}
              {ticket.status === 'WAITING_CLIENT' && (
                <Button
                  variant="outline"
                  className="flex items-center gap-1.5"
                  onClick={() => setStatus('IN_PROGRESS', 'Atendimento retomado.')}
                >
                  <Icon name="play_arrow" className="text-[18px]" />
                  Retomar
                </Button>
              )}
              <Button
                className="flex items-center gap-1.5"
                onClick={() => setStatus('RESOLVED', 'Chamado resolvido.')}
              >
                <Icon name="task_alt" className="text-[18px]" />
                Finalizar OS
              </Button>
            </div>
          )}
        </div>
      </div>

      <Panel title="Gestão do chamado" icon="tune">
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Status
            <Select
              className="h-9 w-48 font-normal"
              value={ticket.status}
              onChange={(e) => setStatus(e.target.value as TicketStatus, 'Status atualizado.')}
            >
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Prioridade
            <Select
              className="h-9 w-40 font-normal"
              value={ticket.priority}
              onChange={(e) =>
                changePriority.mutate(e.target.value as TicketPriority, {
                  onSuccess: () => toast.success('Prioridade atualizada.'),
                  onError: onErr,
                })
              }
            >
              {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Responsável
            <Select
              className="h-9 w-52 font-normal"
              value={ticket.assigneeId ?? ''}
              onChange={(e) =>
                assign.mutate(e.target.value || null, {
                  onSuccess: () => toast.success('Responsável atualizado.'),
                  onError: onErr,
                })
              }
            >
              <option value="">Ninguém</option>
              {agents?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Panel>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Panel title="Descrição e relato" icon="description">
            <p className="whitespace-pre-wrap text-[13px] leading-5">{ticket.description}</p>
            {ticket.attachments.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                <span className="label-mono text-muted-foreground">
                  Evidências ({ticket.attachments.length})
                </span>
                <ul className="flex flex-wrap gap-2">
                  {ticket.attachments.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() =>
                          downloadAttachment(a.id, a.filename).catch(() =>
                            toast.error('Falha no download.'),
                          )
                        }
                        className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[12px] text-primary transition-colors hover:bg-accent"
                      >
                        <Icon name="attach_file" className="text-[18px]" />
                        {a.filename}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <AssetsEditPanel ticket={ticket} />

          <VisitsBlock ticketId={id} />

          <TicketMaterialUsages ticketId={id} />

          <TicketQuotes ticketId={id} />

          <TicketSatisfaction ticket={ticket} />

          <KnowledgeSuggestions ticketId={id} />

          <Panel title="Linha do tempo e apontamentos" icon="history">
            <TicketTimeline ticket={ticket} agents={agents} />
          </Panel>

          <CommentBox ticketId={id} />
        </div>

        <TicketSidebar ticket={ticket} />
      </div>
    </div>
  );
}
