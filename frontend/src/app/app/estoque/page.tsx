'use client';

import { useState } from 'react';
import { useCatalogItems } from '@/lib/catalog';
import {
  useCreateStockEntry,
  useCreateStockTransfer,
  useCreateWarehouse,
  useStockBalances,
  useWarehouses,
} from '@/lib/stock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';

const TABS = [
  { value: 'saldos', label: 'Saldos' },
  { value: 'entradas', label: 'Entradas' },
  { value: 'transferencias', label: 'Transferências' },
  { value: 'depositos', label: 'Depósitos' },
];

export default function StockPage() {
  const [tab, setTab] = useState('saldos');
  const { data: warehouses } = useWarehouses();
  const { data: items } = useCatalogItems({ type: 'PRODUCT' });
  const { data: balances, isLoading } = useStockBalances({});
  const createWarehouse = useCreateWarehouse();
  const createEntry = useCreateStockEntry();
  const createTransfer = useCreateStockTransfer();

  const [newWarehouse, setNewWarehouse] = useState('');
  const [entry, setEntry] = useState({ catalogItemId: '', warehouseId: '', quantity: '', unitCost: '' });
  const [transfer, setTransfer] = useState({ catalogItemId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '' });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Estoque</h1>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'saldos' && (
        <div className="flex flex-col gap-1">
          {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          <ul className="flex flex-col gap-1">
            {balances?.map((b) => (
              <li
                key={`${b.catalogItemId}-${b.warehouseId}`}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${b.belowMinimum ? 'border-warning bg-warning' : 'border-border'}`}
              >
                <span>
                  {b.catalogItem.name} — {b.warehouse.name}: <strong>{b.quantity} {b.catalogItem.unit}</strong>
                  {b.minQuantity != null && <span className="text-muted-foreground"> (mín. {b.minQuantity})</span>}
                </span>
                {b.belowMinimum && <Badge tone="amber">Abaixo do mínimo</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'entradas' && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            createEntry.mutate({
              catalogItemId: entry.catalogItemId,
              warehouseId: entry.warehouseId,
              quantity: Number(entry.quantity),
              unitCost: Number(entry.unitCost),
            });
          }}
        >
          <Select className="h-9 w-56" value={entry.catalogItemId} onChange={(e) => setEntry({ ...entry, catalogItemId: e.target.value })} required>
            <option value="">Item…</option>
            {items?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <Select className="h-9 w-48" value={entry.warehouseId} onChange={(e) => setEntry({ ...entry, warehouseId: e.target.value })} required>
            <option value="">Depósito…</option>
            {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Input className="h-9 w-28" type="number" step="0.01" placeholder="Quantidade" value={entry.quantity} onChange={(e) => setEntry({ ...entry, quantity: e.target.value })} required />
          <Input className="h-9 w-28" type="number" step="0.01" placeholder="Custo unit." value={entry.unitCost} onChange={(e) => setEntry({ ...entry, unitCost: e.target.value })} required />
          <Button type="submit" className="h-9">Registrar entrada</Button>
        </form>
      )}

      {tab === 'transferencias' && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            createTransfer.mutate({
              catalogItemId: transfer.catalogItemId,
              fromWarehouseId: transfer.fromWarehouseId,
              toWarehouseId: transfer.toWarehouseId,
              quantity: Number(transfer.quantity),
            });
          }}
        >
          <Select className="h-9 w-56" value={transfer.catalogItemId} onChange={(e) => setTransfer({ ...transfer, catalogItemId: e.target.value })} required>
            <option value="">Item…</option>
            {items?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <Select className="h-9 w-40" value={transfer.fromWarehouseId} onChange={(e) => setTransfer({ ...transfer, fromWarehouseId: e.target.value })} required>
            <option value="">De…</option>
            {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Select className="h-9 w-40" value={transfer.toWarehouseId} onChange={(e) => setTransfer({ ...transfer, toWarehouseId: e.target.value })} required>
            <option value="">Para…</option>
            {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Input className="h-9 w-28" type="number" step="0.01" placeholder="Quantidade" value={transfer.quantity} onChange={(e) => setTransfer({ ...transfer, quantity: e.target.value })} required />
          <Button type="submit" className="h-9">Transferir</Button>
        </form>
      )}

      {tab === 'depositos' && (
        <div className="flex flex-col gap-3">
          <form
            className="flex items-end gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              createWarehouse.mutate(newWarehouse, { onSuccess: () => setNewWarehouse('') });
            }}
          >
            <Input className="h-9 w-56" placeholder="Nome do depósito" value={newWarehouse} onChange={(e) => setNewWarehouse(e.target.value)} required />
            <Button type="submit" className="h-9">Novo depósito</Button>
          </form>
          <ul className="flex flex-col gap-1">
            {warehouses?.map((w) => (
              <li key={w.id} className="rounded-md border border-border px-3 py-2 text-sm">{w.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
