'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCatalogItems } from '@/lib/catalog';
import { useWarehouses } from '@/lib/stock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface MaterialUsage {
  id: string;
  quantity: number;
  unitCost: number;
  catalogItem: { name: string; unit: string };
  warehouse: { name: string };
}

export function TicketMaterialUsages({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const { data: usages } = useQuery({
    queryKey: ['ticket-material-usages', ticketId],
    queryFn: () => api<MaterialUsage[]>(`/tickets/${ticketId}/material-usages`),
  });
  const { data: items } = useCatalogItems({ type: 'PRODUCT', active: true });
  const { data: warehouses } = useWarehouses();
  const register = useMutation({
    mutationFn: (input: { catalogItemId: string; warehouseId: string; quantity: number }) =>
      api(`/tickets/${ticketId}/material-usages`, { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket-material-usages', ticketId] }),
  });

  const [form, setForm] = useState({ catalogItemId: '', warehouseId: '', quantity: '' });

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-5 shadow-sm">
      <h3 className="text-[14px] font-semibold">Materiais usados</h3>
      <ul className="flex flex-col gap-1">
        {usages?.map((u) => (
          <li key={u.id} className="flex justify-between rounded-lg bg-muted px-3 py-2 text-[13px]">
            <span>{u.catalogItem.name} × {u.quantity} {u.catalogItem.unit} ({u.warehouse.name})</span>
            <span className="text-muted-foreground">R$ {(u.quantity * u.unitCost).toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate(
            { catalogItemId: form.catalogItemId, warehouseId: form.warehouseId, quantity: Number(form.quantity) },
            { onSuccess: () => setForm({ catalogItemId: '', warehouseId: '', quantity: '' }) },
          );
        }}
      >
        <Select className="h-9 flex-1" value={form.catalogItemId} onChange={(e) => setForm({ ...form, catalogItemId: e.target.value })} required>
          <option value="">Item…</option>
          {items?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <Select className="h-9 w-40" value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required>
          <option value="">Depósito…</option>
          {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Input className="h-9 w-24" type="number" step="0.01" placeholder="Qtd." value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
        <Button type="submit" className="h-9">Registrar</Button>
      </form>
    </div>
  );
}
