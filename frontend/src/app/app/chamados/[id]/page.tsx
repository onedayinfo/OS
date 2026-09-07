'use client';

import { useQuery } from '@tanstack/react-query';
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
  type PublicUser,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/tickets';
import { CommentBox } from '@/components/comment-box';
import { TicketSidebar } from '@/components/ticket-sidebar';
import { TicketTimeline } from '@/components/ticket-timeline';
import { Select } from '@/components/ui/select';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
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
