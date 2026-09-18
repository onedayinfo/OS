'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  downloadAttachment,
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
import { Button } from '@/components/ui/button';
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
    <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <h2 className="text-sm font-semibold">Local e ativos</h2>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs uppercase text-muted-foreground">Local</span>
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
        <span className="text-xs uppercase text-muted-foreground">Ativos</span>
        {!locationId ? (
          <p className="text-sm text-muted-foreground">Selecione um local.</p>
        ) : assets?.data.length ? (
          <div className="flex flex-col gap-1 rounded-md border border-input p-2">
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
    <section>
      <h2 className="mb-2 text-sm font-semibold">Visitas</h2>
      <ul className="flex flex-col gap-1">
        {visits.map((v) => (
          <li key={v.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <span>{new Date(v.scheduledStart).toLocaleString('pt-BR')}</span>
            <span className="text-muted-foreground">{v.technician.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{VISIT_STATUS_LABELS[v.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
    return <p className="text-sm text-red-600">Chamado não encontrado.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-xs text-muted-foreground">{ticket.number}</p>
        <h1 className="text-lg font-semibold">{ticket.title}</h1>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <Select
            className="h-9 w-48"
            value={ticket.status}
            onChange={(e) =>
              changeStatus.mutate(e.target.value as TicketStatus, {
                onSuccess: () => toast.success('Status atualizado.'),
                onError: onErr,
              })
            }
          >
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Prioridade
          <Select
            className="h-9 w-40"
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
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Responsável
          <Select
            className="h-9 w-52"
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

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex flex-1 flex-col gap-4">
          <AssetsEditPanel ticket={ticket} />

          <section>
            <h2 className="mb-1 text-sm font-semibold">Descrição</h2>
            <p className="whitespace-pre-wrap rounded-lg border border-border p-3 text-sm">
              {ticket.description}
            </p>
            {ticket.attachments.length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5">
                {ticket.attachments.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() =>
                        downloadAttachment(a.id, a.filename).catch(() =>
                          toast.error('Falha no download.'),
                        )
                      }
                      className="text-sm text-primary hover:underline"
                    >
                      📎 {a.filename}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <VisitsBlock ticketId={id} />

          <section>
            <h2 className="mb-2 text-sm font-semibold">Movimentações</h2>
            <TicketTimeline ticket={ticket} agents={agents} />
          </section>

          <CommentBox ticketId={id} />
        </div>

        <TicketSidebar ticket={ticket} />
      </div>
    </div>
  );
}
