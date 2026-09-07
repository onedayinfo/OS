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
import { cn } from '@/lib/utils';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

function AttachmentList({ items }: { items: Attachment[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {items.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            onClick={() =>
              downloadAttachment(a.id, a.filename).catch(() => alert('Falha no download.'))
            }
            className="text-sm text-primary hover:underline"
          >
            📎 {a.filename}
          </button>
        </li>
      ))}
    </ul>
  );
}

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
}: {
  ticket: TicketDetail;
  agents?: PublicUser[];
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
    <ol className="flex flex-col gap-3">
      {items.map((it) =>
        it.kind === 'event' ? (
          <li key={`e-${it.data.id}`} className="flex gap-2 text-sm text-muted-foreground">
            <span className="whitespace-nowrap">{fmt(it.at)}</span>
            <span>·</span>
            <span>
              {eventText(it.data, nameFor)}
              {it.data.actorId ? ` (${nameFor(it.data.actorId)})` : ''}
            </span>
          </li>
        ) : (
          <li
            key={`c-${it.data.id}`}
            className={cn(
              'rounded-lg border p-3',
              it.data.visibility === 'INTERNAL'
                ? 'border-amber-200 bg-amber-50'
                : 'border-border bg-background',
            )}
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{nameFor(it.data.authorId)}</span>
              <span>·</span>
              <span>{fmt(it.at)}</span>
              <Badge tone={it.data.visibility === 'INTERNAL' ? 'amber' : 'green'}>
                {it.data.visibility === 'INTERNAL' ? 'Interno' : 'Público'}
              </Badge>
            </div>
            <p className="whitespace-pre-wrap text-sm">{it.data.body}</p>
            <AttachmentList items={it.data.attachments} />
          </li>
        ),
      )}
      {items.length === 0 && (
        <li className="text-sm text-muted-foreground">Sem movimentações ainda.</li>
      )}
    </ol>
  );
}
