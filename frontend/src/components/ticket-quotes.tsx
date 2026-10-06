'use client';

import Link from 'next/link';
import { QUOTE_STATUS_LABELS, useQuotes } from '@/lib/quotes';

export function TicketQuotes({ ticketId }: { ticketId: string }) {
  const { data: quotes } = useQuotes({ ticketId });
  if (!quotes?.length) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-5 shadow-sm">
      <h3 className="text-[14px] font-semibold">Orçamentos</h3>
      <ul className="flex flex-col gap-1">
        {quotes.map((q) => (
          <li key={q.id}>
            <Link href={`/app/orcamentos/${q.id}`} className="flex justify-between rounded-lg bg-muted px-3 py-2 text-[13px] hover:bg-accent">
              <span>#{q.number} v{q.version}</span>
              <span>{QUOTE_STATUS_LABELS[q.status]} — R$ {q.total.toFixed(2)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
