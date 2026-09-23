'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  isOverdue,
  useTickets,
  type Paged,
  type TicketFilters,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/tickets';
import type { PublicUser } from '@/lib/tickets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Category {
  id: string;
  name: string;
}
interface ClientRow {
  id: string;
  name: string;
}

const PRIORITY_TONE: Record<TicketPriority, 'neutral' | 'blue' | 'amber' | 'red'> = {
  LOW: 'neutral',
  MEDIUM: 'blue',
  HIGH: 'amber',
  URGENT: 'red',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Fila de chamados reutilizável. `clientId` fixa o filtro de cliente (aba
 * Chamados do detalhe do cliente) e some com o select correspondente.
 */
export function TicketTable({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const [filters, setFilters] = useState<TicketFilters>({ page: 1, pageSize: 20 });

  const query: TicketFilters = { ...filters, clientId: clientId ?? filters.clientId };
  const { data, isLoading, isError } = useTickets(query);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });
  const { data: agents } = useQuery({
    queryKey: ['users', 'INTERNAL'],
    queryFn: () => api<PublicUser[]>('/users?type=INTERNAL'),
  });
  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<ClientRow>>('/clients?pageSize=100'),
    enabled: !clientId,
  });

  const agentName = useMemo(() => {
    const m = new Map<string, string>();
    agents?.forEach((a) => m.set(a.id, a.name));
    return m;
  }, [agents]);
  const clientName = useMemo(() => {
    const m = new Map<string, string>();
    clients?.data.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [clients]);

  function patch(p: Partial<TicketFilters>) {
    setFilters((f) => ({ ...f, ...p, page: p.page ?? 1 }));
  }

  const rows = data?.data ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = filters.page ?? 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          placeholder="Buscar por número ou título"
          className="h-9 w-64"
          defaultValue={filters.q ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') patch({ q: (e.target as HTMLInputElement).value.trim() });
          }}
        />
        <Select
          className="h-9 w-40"
          value={filters.status ?? ''}
          onChange={(e) => patch({ status: e.target.value as TicketStatus | '' })}
        >
          <option value="">Status: todos</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          className="h-9 w-40"
          value={filters.priority ?? ''}
          onChange={(e) => patch({ priority: e.target.value as TicketPriority | '' })}
        >
          <option value="">Prioridade: todas</option>
          {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          className="h-9 w-40"
          value={filters.categoryId ?? ''}
          onChange={(e) => patch({ categoryId: e.target.value || undefined })}
        >
          <option value="">Categoria: todas</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          className="h-9 w-44"
          value={filters.assigneeId ?? ''}
          onChange={(e) => patch({ assigneeId: e.target.value || undefined })}
        >
          <option value="">Responsável: todos</option>
          {agents?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        {!clientId && (
          <Select
            className="h-9 w-44"
            value={filters.clientId ?? ''}
            onChange={(e) => patch({ clientId: e.target.value || undefined })}
          >
            <option value="">Cliente: todos</option>
            {clients?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={!!filters.overdue}
            onChange={(e) => patch({ overdue: e.target.checked })}
          />
          Só vencidos
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={!!filters.needsTriage}
            onChange={(e) => patch({ needsTriage: e.target.checked })}
          />
          Só triagem
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Número</th>
              <th className="px-3 py-2 font-medium">Título</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Prioridade</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Responsável</th>
              <th className="px-3 py-2 font-medium">SLA</th>
              <th className="px-3 py-2 font-medium">Criado em</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-destructive-foreground">
                  Erro ao carregar chamados.
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum chamado encontrado.
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr
                key={t.id}
                onClick={() => router.push(`/app/chamados/${t.id}`)}
                className="cursor-pointer border-t border-border hover:bg-accent"
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{t.number}</td>
                <td className="px-3 py-2">{t.title}</td>
                <td className="px-3 py-2">
                  {t.clientId ? clientName.get(t.clientId) ?? '—' : '—'}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABELS[t.priority]}</Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="neutral">{STATUS_LABELS[t.status]}</Badge>
                    {isOverdue(t) && <Badge tone="red">vencido</Badge>}
                    {t.needsTriage && <Badge tone="amber">triagem</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {t.assigneeId ? agentName.get(t.assigneeId) ?? '—' : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {t.slaDueAt ? fmtDate(t.slaDueAt) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {fmtDate(t.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{data?.total ?? 0} chamado(s)</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8"
            disabled={page <= 1}
            onClick={() => patch({ page: page - 1 })}
          >
            Anterior
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            className="h-8"
            disabled={page >= totalPages}
            onClick={() => patch({ page: page + 1 })}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
