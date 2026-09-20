'use client';

import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QUOTE_STATUS_LABELS, useQuote, useReviseQuote, useSendQuote } from '@/lib/quotes';

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: quote, isLoading } = useQuote(id);
  const send = useSendQuote();
  const revise = useReviseQuote();

  if (isLoading || !quote) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/orcamento/${quote.publicToken}` : '';

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Orçamento #{quote.number} v{quote.version}
        </h1>
        <Badge>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
      </div>

      <ul className="flex flex-col gap-1">
        {quote.items.map((item, idx) => (
          <li key={idx} className="flex justify-between rounded-md border border-border px-3 py-2 text-sm">
            <span>{item.catalogItem.name} × {item.quantity}</span>
            <span>R$ {(item.quantity * item.unitPrice).toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <div className="text-right text-sm font-semibold">Total: R$ {quote.total.toFixed(2)}</div>

      {quote.status === 'DRAFT' && (
        <Button className="h-9 w-fit" onClick={() => send.mutate(quote.id)}>Enviar</Button>
      )}
      {(quote.status === 'SENT' || quote.status === 'REJECTED') && (
        <div className="flex items-center gap-2">
          <Input readOnly value={publicUrl} className="h-9" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="ghost" className="h-9" onClick={() => revise.mutate(quote.id)}>Revisar</Button>
        </div>
      )}
    </div>
  );
}
