'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Paged } from '@/lib/tickets';
import {
  ASSET_STATUS_LABELS,
  type Asset,
  type AssetStatus,
  type AssetType,
} from '@/lib/assets';
import { AssetForm, type AssetFormPayload } from '@/components/asset-form';
import { AssetImportDialog } from '@/components/asset-import-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface ClientRow {
  id: string;
  name: string;
}
interface LocationRow {
  id: string;
  name: string;
}

const STATUS_TONE: Record<AssetStatus, 'green' | 'amber' | 'neutral'> = {
  ACTIVE: 'green',
  MAINTENANCE: 'amber',
  INACTIVE: 'neutral',
};

function isExpired(warrantyEndsAt: string | null): boolean {
  return !!warrantyEndsAt && new Date(warrantyEndsAt).getTime() < Date.now();
}

export default function AssetsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setLocationId('');
  }, [clientId]);

  const { data: clients } = useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () => api<Paged<ClientRow>>('/clients?pageSize=100'),
  });
  const { data: locations } = useQuery({
    queryKey: ['locations', 'options', clientId],
    queryFn: () =>
      api<Paged<LocationRow>>(
        `/locations?pageSize=100&clientId=${encodeURIComponent(clientId)}`,
      ),
    enabled: !!clientId,
  });
  const { data: types } = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => api<AssetType[]>('/asset-types'),
  });

  const queryString = useMemo(() => {
    const p = new URLSearchParams({ pageSize: '100' });
    if (debouncedQ) p.set('q', debouncedQ);
    if (clientId) p.set('clientId', clientId);
    if (locationId) p.set('locationId', locationId);
    if (typeId) p.set('typeId', typeId);
    if (status) p.set('status', status);
    return p.toString();
  }, [debouncedQ, clientId, locationId, typeId, status]);

  const { data, isLoading } = useQuery({
    queryKey: ['assets', 'list', queryString],
    queryFn: () => api<Paged<Asset>>(`/assets?${queryString}`),
  });

  const create = useMutation({
    mutationFn: (v: AssetFormPayload) =>
      api<Asset>('/assets', { method: 'POST', body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      setCreating(false);
      toast.success('Ativo criado.');
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Falha ao criar o ativo.'),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Ativos</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}>
            Importar CSV
          </Button>
          <Button onClick={() => setCreating(true)}>Novo ativo</Button>
        </div>
      </div>

      <Dialog open={importing} onClose={() => setImporting(false)} title="Importar ativos por CSV">
        <AssetImportDialog />
      </Dialog>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Novo ativo">
        <AssetForm
          submitLabel="Criar ativo"
          busy={create.isPending}
          onSubmit={(v) => create.mutate(v)}
          onCancel={() => setCreating(false)}
        />
      </Dialog>

      <div className="flex flex-wrap gap-2">
        <Select
          className="w-48"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          <option value="">Todos os clientes</option>
          {clients?.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-48"
          value={locationId}
          disabled={!clientId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">Todos os locais</option>
          {locations?.data.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-48"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
        >
          <option value="">Todos os tipos</option>
          {types?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value as AssetStatus | '')}
        >
          <option value="">Todos os status</option>
          {(Object.keys(ASSET_STATUS_LABELS) as AssetStatus[]).map((s) => (
            <option key={s} value={s}>
              {ASSET_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Buscar por identificação, série, marca"
          className="w-72"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Identificação</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Local</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Nº série</th>
              <th className="px-3 py-2 font-medium">Garantia</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {data?.data.map((a) => (
              <tr key={a.id} className="border-t border-border hover:bg-accent">
                <td className="px-3 py-2">
                  <Link
                    href={`/app/ativos/${a.id}`}
                    className="text-primary hover:underline"
                  >
                    {a.label}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{a.type?.name ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.client?.name ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {a.location?.name ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[a.status]}>
                    {ASSET_STATUS_LABELS[a.status]}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {a.serialNumber ?? '—'}
                </td>
                <td
                  className={`px-3 py-2 ${
                    isExpired(a.warrantyEndsAt)
                      ? 'text-destructive-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  {a.warrantyEndsAt
                    ? new Date(a.warrantyEndsAt).toLocaleDateString('pt-BR')
                    : '—'}
                </td>
              </tr>
            ))}
            {data && data.data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum ativo encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
