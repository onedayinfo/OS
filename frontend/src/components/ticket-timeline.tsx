'use client';

import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  downloadAttachment,
  type Attachment,
  type PublicUser,
  type TicketDetail,
  type TicketEvent,
} from '@/lib/tickets';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function AttachmentList({ items }: { items: Attachment[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {items.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            onClick={() =>
              downloadAttachment(a.id, a.filename).catch(() => alert('Falha no download.'))
            }
            className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12px] text-primary hover:bg-accent"
          >
            <Icon name="attach_file" className="text-[16px]" />
            {a.filename}
          </button>
        </li>
      ))}
    </ul>
  );
}

const EVENT_TAGS: Partial<Record<TicketEvent['type'], string>> = {
  CREATED: 'Criado',
  STATUS_CHANGED: 'Status',
  ASSIGNED: 'Responsável',
  PRIORITY_CHANGED: 'Prioridade',
  EMAIL_IN: 'E-mail',
  EMAIL_OUT: 'E-mail',
  WHATSAPP_IN: 'WhatsApp',
  VISIT_SCHEDULED: 'Visita',
  VISIT_STARTED: 'Check-in',
  VISIT_COMPLETED: 'Visita',
  VISIT_CANCELLED: 'Visita',
};

function eventText(e: TicketEvent, nameFor: (id: string | null) => string): string {
  const d = e.data as Record<string, string | null>;
  switch (e.type) {
    case 'CREATED':
      return 'Chamado criado';
    case 'STATUS_CHANGED':
      return `Status: ${STATUS_LABELS[d.from as never] ?? d.from} → ${
        STATUS_LABELS[d.to as never] ?? d.to
      }`;
    case 'ASSIGNED':
      return `Responsável: ${d.from ? nameFor(d.from) : 'ninguém'} → ${
        d.to ? nameFor(d.to) : 'ninguém'
      }`;
    case 'PRIORITY_CHANGED':
      return `Prioridade: ${PRIORITY_LABELS[d.from as never] ?? d.from} → ${
        PRIORITY_LABELS[d.to as never] ?? d.to
      }`;
    case 'EMAIL_IN':
      return 'E-mail recebido';
    case 'EMAIL_OUT':
      return 'E-mail enviado';
    case 'WHATSAPP_IN':
      return `WhatsApp — ${d.sender ?? 'alguém'}: ${d.text ?? ''}`;
    case 'VISIT_SCHEDULED':
      return 'Visita agendada';
    case 'VISIT_STARTED':
      return 'Visita iniciada (check-in)';
    case 'VISIT_COMPLETED':
      return 'Visita concluída';
    case 'VISIT_CANCELLED':
      return 'Visita cancelada';
    default:
      return e.type;
  }
}

type Item =
  | { kind: 'comment'; at: string; data: TicketDetail['comments'][number] }
  | { kind: 'event'; at: string; data: TicketEvent };

export function TicketTimeline({
  ticket,
  agents = [],
  allowInternal = true,
}: {
  ticket: TicketDetail;
  agents?: PublicUser[];
  /** Portal do cliente passa `false`: sem badge "Interno" (o backend já filtra). */
  allowInternal?: boolean;
}) {
  const names = new Map<string, string>();
  agents.forEach((a) => names.set(a.id, a.name));
  if (ticket.requester) names.set(ticket.requester.id, ticket.requester.name);
  if (ticket.assignee) names.set(ticket.assignee.id, ticket.assignee.name);
  const nameFor = (id: string | null) => (id ? names.get(id) ?? id : '—');

  const items: Item[] = [
    ...ticket.comments.map((c) => ({ kind: 'comment' as const, at: c.createdAt, data: c })),
    // COMMENT já aparece como comentário; evita duplicar na timeline.
    ...ticket.events
      .filter((e) => e.type !== 'COMMENT')
      .map((e) => ({ kind: 'event' as const, at: e.createdAt, data: e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <ol className="relative ml-1.5 flex flex-col gap-4 border-l-2 border-border pl-5">
      {items.map((it) =>
        it.kind === 'event' ? (
          <li key={`e-${it.data.id}`} className="relative">
            <span className="absolute -left-[27px] top-1 h-2.5 w-2.5 rounded-full bg-muted-foreground/40 ring-4 ring-card" />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{EVENT_TAGS[it.data.type] ?? 'Evento'}</Badge>
              <span className="text-[13px]">
                {eventText(it.data, nameFor)}
                {it.data.actorId ? ` (${nameFor(it.data.actorId)})` : ''}
              </span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">{fmt(it.at)}</span>
            </div>
          </li>
        ) : (
          <li key={`c-${it.data.id}`} className="relative">
            <span className="absolute -left-[27px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card" />
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {allowInternal && (
                <Badge tone={it.data.visibility === 'INTERNAL' ? 'amber' : 'green'}>
                  {it.data.visibility === 'INTERNAL' ? 'Nota interna' : 'Público'}
                </Badge>
              )}
              <span className="text-[13px] font-semibold">{nameFor(it.data.authorId)}</span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">{fmt(it.at)}</span>
            </div>
            <div
              className={cn(
                'rounded-lg p-3',
                allowInternal && it.data.visibility === 'INTERNAL' ? 'bg-warning' : 'bg-muted',
              )}
            >
              <p className="whitespace-pre-wrap text-[13px]">{it.data.body}</p>
              <AttachmentList items={it.data.attachments} />
            </div>
          </li>
        ),
      )}
      {items.length === 0 && (
        <li className="text-[13px] text-muted-foreground">Sem movimentações ainda.</li>
      )}
    </ol>
  );
}
