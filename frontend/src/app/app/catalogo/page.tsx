'use client';

import { useState } from 'react';
import {
  CATALOG_ITEM_TYPE_LABELS,
  useCatalogItems,
  useCreateCatalogItem,
  useUpdateCatalogItem,
  type CatalogItem,
  type CatalogItemType,
} from '@/lib/catalog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function CatalogPage() {
  const [type, setType] = useState<CatalogItemType | ''>('');
  const { data: items, isLoading } = useCatalogItems({ type: type || undefined });
  const [form, setForm] = useState({ name: '', type: 'SERVICE' as CatalogItemType, unit: '', price: '' });
  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Catálogo</h1>

      <form
        className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name: form.name, type: form.type, unit: form.unit, price: Number(form.price) },
            { onSuccess: () => setForm({ name: '', type: 'SERVICE', unit: '', price: '' }) },
          );
        }}
      >
        <Input className="h-9 w-56" placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Select className="h-9 w-36" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CatalogItemType })}>
          {Object.entries(CATALOG_ITEM_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
        <Input className="h-9 w-24" placeholder="Unidade" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required />
        <Input className="h-9 w-32" type="number" step="0.01" placeholder="Preço" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        <Button type="submit" className="h-9">Adicionar</Button>
      </form>

      <div className="flex gap-2">
        <Select className="h-9 w-40" value={type} onChange={(e) => setType(e.target.value as CatalogItemType | '')}>
          <option value="">Todos os tipos</option>
          {Object.entries(CATALOG_ITEM_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <ul className="flex flex-col gap-1">
        {items?.map((item) => (
          <CatalogItemRow key={item.id} item={item} onToggle={() => update.mutate({ id: item.id, active: !item.active })} />
        ))}
      </ul>
    </div>
  );
}

function CatalogItemRow({ item, onToggle }: { item: CatalogItem; onToggle: () => void }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        <Badge tone={item.type === 'PRODUCT' ? 'blue' : 'neutral'}>{CATALOG_ITEM_TYPE_LABELS[item.type]}</Badge>
        {item.name}
        <span className="text-muted-foreground">— {item.unit} — R$ {item.price.toFixed(2)}</span>
        {!item.active && <Badge tone="neutral">Inativo</Badge>}
      </span>
      <Button variant="ghost" className="h-8" onClick={onToggle}>
        {item.active ? 'Desativar' : 'Ativar'}
      </Button>
    </li>
  );
}
