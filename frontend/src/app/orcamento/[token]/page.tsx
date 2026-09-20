'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

interface PublicQuote {
  number: number;
  status: string;
  items: { quantity: number; unitPrice: number; catalogItem: { name: string; unit: string } }[];
  total: number;
}

export default function PublicQuotePage() {
  const { token } = useParams<{ token: string }>();
  const [actionResult, setActionResult] = useState<string | null>(null);
  const { data: quote, isLoading, refetch } = useQuery({
    queryKey: ['public-quote', token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/quotes/${token}`);
      if (!res.ok) throw new Error('Orçamento não encontrado.');
      return (await res.json()) as PublicQuote;
    },
  });

  async function act(action: 'approve' | 'reject') {
    const res = await fetch(`${API_BASE}/public/quotes/${token}/${action}`, { method: 'POST' });
    if (res.status === 409) {
      setActionResult('Este orçamento já foi respondido.');
    } else if (res.ok) {
      setActionResult(action === 'approve' ? 'Orçamento aprovado! Entraremos em contato.' : 'Orçamento rejeitado.');
    }
    refetch();
  }

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
  if (!quote) return <p className="p-6 text-sm text-muted-foreground">Orçamento não encontrado.</p>;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Orçamento #{quote.number}</h1>
      <ul className="flex flex-col gap-1">
        {quote.items.map((item, idx) => (
          <li key={idx} className="flex justify-between rounded-md border border-border px-3 py-2 text-sm">
            <span>{item.catalogItem.name} × {item.quantity} {item.catalogItem.unit}</span>
            <span>R$ {(item.quantity * item.unitPrice).toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <div className="text-right text-sm font-semibold">Total: R$ {quote.total.toFixed(2)}</div>

      {actionResult && <p className="text-sm">{actionResult}</p>}
      {!actionResult && quote.status === 'SENT' && (
        <div className="flex gap-2">
          <button className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground" onClick={() => act('approve')}>
            Aprovar
          </button>
          <button className="h-9 rounded-md border border-border px-4 text-sm" onClick={() => act('reject')}>
            Rejeitar
          </button>
        </div>
      )}
      {!actionResult && quote.status !== 'SENT' && (
        <p className="text-sm text-muted-foreground">Este orçamento já foi respondido.</p>
      )}
    </div>
  );
}
