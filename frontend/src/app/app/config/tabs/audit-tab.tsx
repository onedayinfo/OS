'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';

type SettingsView = Record<string, string | boolean>;
interface AuditRow {
  id: string;
  createdAt: string;
  kind: 'ACTION' | 'ERROR';
  level: 'info' | 'warn' | 'error';
  actorId: string | null;
  actorLabel: string | null;
  ip: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  module: string | null;
  message: string | null;
  data: unknown;
  actor: { name: string; email: string } | null;
}
interface AuditPage {
  data: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 50;
const LEVEL_TONE = { info: 'blue', warn: 'amber', error: 'red' } as const;
const errToast = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export default function AuditTab() {
  const qc = useQueryClient();
  const [kind, setKind] = useState('');
  const [module, setModule] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [days, setDays] = useState('90');

  const { data: modules } = useQuery({
    queryKey: ['audit-modules'],
    queryFn: () => api<string[]>('/audit/modules'),
  });

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (kind) params.set('kind', kind);
  if (module) params.set('module', module);
  if (q.trim()) params.set('q', q.trim());
  // from/to da API são ISO 8601: início e fim do dia local.
  if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());

  const { data, isLoading } = useQuery({
    queryKey: ['audit', params.toString()],
    queryFn: () => api<AuditPage>(`/audit?${params}`),
  });
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsView>('/settings'),
  });
  useEffect(() => {
    if (settings) setDays((settings['audit.retentionDays'] as string) || '90');
  }, [settings]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings', { method: 'PUT', body: { values: { 'audit.retentionDays': days } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Retenção salva.');
    },
    onError: errToast,
  });

  // Qualquer mudança de filtro volta para a primeira página.
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label>Tipo</Label>
          <Select className="w-32" value={kind} onChange={(e) => filter(setKind)(e.target.value)}>
            <option value="">Todos</option>
            <option value="ACTION">Ações</option>
            <option value="ERROR">Falhas</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Módulo</Label>
          <Select className="w-40" value={module} onChange={(e) => filter(setModule)(e.target.value)}>
            <option value="">Todos</option>
            {modules?.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>De</Label>
          <Input type="date" className="w-40" value={from} onChange={(e) => filter(setFrom)(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Até</Label>
          <Input type="date" className="w-40" value={to} onChange={(e) => filter(setTo)(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Busca</Label>
          <Input
            className="w-56"
            placeholder="Texto na mensagem ou caminho"
            value={q}
            onChange={(e) => filter(setQ)(e.target.value)}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Usuário</th>
              <th className="px-3 py-2 font-medium">Módulo</th>
              <th className="px-3 py-2 font-medium">Ação / mensagem</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-border hover:bg-accent"
                onClick={() => setSelected(r)}
              >
                <td className="whitespace-nowrap px-3 py-2">
                  {new Date(r.createdAt).toLocaleString('pt-BR')}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={LEVEL_TONE[r.level] ?? 'neutral'}>
                    {r.kind === 'ERROR' ? 'Falha' : 'Ação'}
                  </Badge>
                </td>
                <td className="px-3 py-2">{r.actor?.name ?? r.actorLabel ?? '—'}</td>
                <td className="px-3 py-2">{r.module ?? '—'}</td>
                <td className="max-w-md truncate px-3 py-2">{r.message ?? r.path ?? '—'}</td>
                <td className="px-3 py-2">{r.status ?? '—'}</td>
              </tr>
            ))}
            {!isLoading && !data?.data.length && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </Button>
        <span className="text-muted-foreground">
          Página {page} de {totalPages}
        </span>
        <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Próxima
        </Button>
      </div>

      <Panel title="Retenção" className="max-w-lg">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label>Dias de retenção</Label>
            <Input
              type="number"
              min={1}
              className="w-28"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Registros mais antigos que {days || 'N'} dias são apagados todo dia às 03:30.
        </p>
      </Panel>

      <Dialog open={!!selected} onClose={() => setSelected(null)} title="Detalhe do registro" className="max-w-2xl">
        {selected && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <b>Mensagem:</b> {selected.message ?? '—'}
            </p>
            <p>
              <b>Caminho:</b> {selected.method} {selected.path ?? '—'}
            </p>
            <p>
              <b>IP:</b> {selected.ip ?? '—'}
            </p>
            <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(selected.data, null, 2)}
            </pre>
          </div>
        )}
      </Dialog>
    </div>
  );
}
