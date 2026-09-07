'use client';

import { toast } from 'sonner';
import { STATUS_LABELS, downloadAttachment, useTicket } from '@/lib/tickets';
import { CommentBox } from '@/components/comment-box';
import { TicketTimeline } from '@/components/ticket-timeline';
import { Badge } from '@/components/ui/badge';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

export default function PortalTicketDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data: ticket, isLoading, isError } = useTicket(id);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !ticket)
    return <p className="text-sm text-red-600">Chamado não encontrado.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-xs text-muted-foreground">{ticket.number}</p>
        <h1 className="text-lg font-semibold">{ticket.title}</h1>
        <div className="mt-1">
          <Badge tone="neutral">{STATUS_LABELS[ticket.status]}</Badge>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:max-w-md">
        <dt className="text-muted-foreground">Categoria</dt>
        <dd>{ticket.category?.name ?? '—'}</dd>
        <dt className="text-muted-foreground">Aberto em</dt>
        <dd>{fmt(ticket.createdAt)}</dd>
        <dt className="text-muted-foreground">Última atualização</dt>
        <dd>{fmt(ticket.updatedAt)}</dd>
      </dl>

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
        <TicketTimeline ticket={ticket} allowInternal={false} />
      </section>

      <CommentBox ticketId={id} allowInternal={false} />
    </div>
  );
}
