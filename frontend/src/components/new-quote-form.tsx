'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { type Paged } from '@/lib/tickets';
import { useCatalogItems } from '@/lib/catalog';
import { useCreateQuote, type QuoteItemInput } from '@/lib/quotes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Category {
  id: string;
  name: string;
}

export function NewQuoteForm({
  ticketId,
  onCreated,
}: {
  ticketId?: string;
  onCreated: (quoteId: string) => void;
}) {
  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api<Category[]>('/categories'),
  });
  const { data: catalogItems } = useCatalogItems({ active: true });
  const create = useCreateQuote();

  const [clientId, setClientId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<QuoteItemInput[]>([{ catalogItemId: '', quantity: 1 }]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          {
            clientId,
            ticketId,
            categoryId: ticketId ? undefined : categoryId,
            title: ticketId ? undefined : title,
            items: items.filter((i) => i.catalogItemId),
          },
          { onSuccess: (q) => onCreated(q.id) },
        );
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Cliente
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
          <option value="">Selecione…</option>
          {clients?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </label>

      {!ticketId && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Categoria (chamado gerado na aprovação)
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              <option value="">Selecione…</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Título do chamado
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
        </>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Itens</span>
        {items.map((item, idx) => (
          <div key={idx} className="flex gap-2">
            <Select
              className="h-9 flex-1"
              value={item.catalogItemId}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...next[idx], catalogItemId: e.target.value };
                setItems(next);
              }}
            >
              <option value="">Item…</option>
              {catalogItems?.map((ci) => <option key={ci.id} value={ci.id}>{ci.name} — R$ {ci.price.toFixed(2)}/{ci.unit}</option>)}
            </Select>
            <Input
              className="h-9 w-24"
              type="number"
              step="0.01"
              value={item.quantity}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                setItems(next);
              }}
            />
          </div>
        ))}
        <Button type="button" variant="ghost" className="h-8 w-fit" onClick={() => setItems([...items, { catalogItemId: '', quantity: 1 }])}>
          + item
        </Button>
      </div>

      <Button type="submit" className="h-9 w-fit">Criar orçamento</Button>
    </form>
  );
}
