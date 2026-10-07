'use client';

import Link from 'next/link';
import { toast } from 'sonner';
import { STATUS_LABELS, downloadAttachment, useTicket } from '@/lib/tickets';
import { CommentBox } from '@/components/comment-box';
import { TicketProgress } from '@/components/ticket-progress';
import { TicketTimeline } from '@/components/ticket-timeline';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Panel } from '@/components/ui/panel';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

const STATUS_TONE = {
  OPEN: 'blue',
  IN_PROGRESS: 'blue',
  WAITING_CLIENT: 'amber',
  RESOLVED: 'green',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
} as const;

export default function PortalTicketDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data: ticket, isLoading, isError } = useTicket(id);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !ticket)
    return <p className="text-sm text-destructive-foreground">Chamado não encontrado.</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <nav className="flex items-center gap-1 text-[12px] text-muted-foreground">
          <Link href="/portal" className="hover:text-foreground">
            Meus chamados
          </Link>
          <Icon name="chevron_right" className="text-[16px]" />
          <span>{ticket.number}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <p className="label-mono rounded bg-info px-2 py-1 font-mono text-info-foreground">
            {ticket.number}
          </p>
          <Badge tone={STATUS_TONE[ticket.status]} dot>
            {STATUS_LABELS[ticket.status]}
          </Badge>
        </div>
        <h1 className="text-[24px] font-semibold leading-8">{ticket.title}</h1>
      </div>

      <Panel title="Andamento" icon="route">
        <TicketProgress status={ticket.status} />
      </Panel>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Panel title="Descrição" icon="description">
            <p className="whitespace-pre-wrap text-[13px] leading-5">{ticket.description}</p>
            {ticket.attachments.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2">
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
            )}
          </Panel>

          <Panel title="Movimentações" icon="history">
            <TicketTimeline ticket={ticket} allowInternal={false} />
          </Panel>

          <CommentBox ticketId={id} allowInternal={false} />
        </div>

        <aside className="w-full shrink-0 lg:w-72">
          <Panel title="Detalhes" icon="info">
            <dl className="flex flex-col gap-3 text-[13px]">
              <div className="flex flex-col gap-0.5">
                <dt className="label-mono text-muted-foreground">Categoria</dt>
                <dd>{ticket.category?.name ?? '—'}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="label-mono text-muted-foreground">Aberto em</dt>
                <dd>{fmt(ticket.createdAt)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="label-mono text-muted-foreground">Última atualização</dt>
                <dd>{fmt(ticket.updatedAt)}</dd>
              </div>
            </dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
