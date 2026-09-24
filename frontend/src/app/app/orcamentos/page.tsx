'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { NewQuoteForm } from '@/components/new-quote-form';
import { QUOTE_STATUS_LABELS, useQuotes, type Quote, type QuoteStatus } from '@/lib/quotes';

function statusTone(s: QuoteStatus) {
  if (s === 'APPROVED') return 'green';
  if (s === 'REJECTED' || s === 'SUPERSEDED') return 'neutral';
  if (s === 'SENT') return 'blue';
  return 'amber';
}

export default function QuotesPage() {
  const router = useRouter();
  const { data: quotes, isLoading } = useQuotes({});
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Orçamentos</h1>
        <Button className="h-9" onClick={() => setCreating(true)}>
          Novo orçamento
        </Button>
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Novo orçamento">
        <NewQuoteForm
          onCreated={(id) => {
            setCreating(false);
            router.push(`/app/orcamentos/${id}`);
          }}
        />
      </Dialog>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <ul className="flex flex-col gap-1">
        {quotes?.map((q: Quote) => (
          <li key={q.id}>
            <Link
              href={`/app/orcamentos/${q.id}`}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              <span>
                #{q.number} v{q.version} — {q.client?.name} {q.title ? `— ${q.title}` : ''}
              </span>
              <span className="flex items-center gap-2">
                <span>R$ {q.total.toFixed(2)}</span>
                <Badge tone={statusTone(q.status)}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
