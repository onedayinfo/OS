'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { useDashboardOverview } from '@/lib/dashboard';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  isOverdue,
  toQuery,
  useTickets,
  type Paged,
  type TicketFilters,
  type TicketListItem,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/tickets';
import type { PublicUser } from '@/lib/tickets';
import { cn } from '@/lib/utils';
import { SlaIndicator } from '@/components/sla-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';

interface Category {
  id: string;
  name: string;
}
interface ClientRow {
  id: string;
  name: string;
}

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

const PRIORITY_TONE: Record<TicketPriority, Tone> = {
  LOW: 'neutral',
  MEDIUM: 'neutral',
  HIGH: 'red',
  URGENT: 'red',
};

const STATUS_TONE: Record<TicketStatus, Tone> = {
  OPEN: 'blue',
  IN_PROGRESS: 'blue',
  WAITING_CLIENT: 'amber',
  RESOLVED: 'green',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

type View = 'all' | 'mine' | 'overdue' | 'waiting' | 'triage';

function useTotal(f: TicketFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['tickets', 'total', f],
    queryFn: () => api<Paged<TicketListItem>>(`/tickets?${toQuery({ ...f, page: 1, pageSize: 1 })}`),
    enabled,
    select: (d) => d.total,
  });
}

function useQueueCounts(userId: string | undefined, enabled: boolean) {
  const all = useTotal({}, enabled);
  const mine = useTotal({ assigneeId: userId, active: true }, enabled && !!userId);
  const overdue = useTotal({ overdue: true }, enabled);
  const waiting = useTotal({ status: 'WAITING_CLIENT' }, enabled);
  const triage = useTotal({ needsTriage: true, active: true }, enabled);
  return {
    all: all.data,
    mine: mine.data,
    overdue: overdue.data,
    waiting: waiting.data,
    triage: triage.data,
  };
}

function Kpi({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: number | string | undefined;
  hint: string;
  icon: string;
  tone?: 'default' | 'primary' | 'danger';
}) {
  const color =
    tone === 'danger' ? 'text-destructive-foreground' : tone === 'primary' ? 'text-primary' : 'text-foreground';
  return (
    <div className="flex flex-col justify-between rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className={cn('label-mono', tone === 'danger' ? 'text-destructive-foreground' : 'text-muted-foreground')}>
          {label}
        </span>
        <Icon
          name={icon}
          className={cn('text-[20px]', tone === 'danger' ? 'text-destructive-foreground' : tone === 'primary' ? 'text-primary' : 'text-muted-foreground')}
        />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn('text-[20px] font-semibold leading-7 tracking-tight', color)}>{value ?? '—'}</span>
        <span className="label-mono text-muted-foreground">{hint}</span>
      </div>
    </div>
  );
}

/**
 * Fila de chamados reutilizável. `clientId` fixa o filtro de cliente (aba
 * Chamados do detalhe do cliente) e some com o select correspondente.
 * `summary` liga o cabeçalho de indicadores e as pílulas de visão (só na Fila).
 */
export function TicketTable({ clientId, summary = false }: { clientId?: string; summary?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const urlQ = clientId ? null : searchParams.get('q');
  const [filters, setFilters] = useState<TicketFilters>({ page: 1, pageSize: 20 });
  const [qText, setQText] = useState('');
  const [view, setView] = useState<View>('all');

  // Busca do topo (/app?q=...) filtra a fila.
  useEffect(() => {
    if (urlQ === null) return;
    setQText(urlQ);
    setFilters((f) => ({ ...f, q: urlQ.trim() || undefined, page: 1 }));
  }, [urlQ]);

  const viewFilters: TicketFilters = useMemo(() => {
    if (!summary) return {};
    if (view === 'mine') return { assigneeId: user?.id, active: true };
    if (view === 'overdue') return { overdue: true };
    if (view === 'waiting') return { status: 'WAITING_CLIENT' };
    if (view === 'triage') return { needsTriage: true, active: true };
    return {};
  }, [summary, view, user?.id]);

  const query: TicketFilters = { ...filters, ...viewFilters, clientId: clientId ?? filters.clientId };
  const { data, isLoading, isError } = useTickets(query);

  const counts = useQueueCounts(user?.id, summary);
  const overview = useDashboardOverview(summary);

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
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Fila aberta" value={overview.data?.tickets.open} hint="em aberto" icon="receipt_long" />
          <Kpi label="Atribuídas a mim" value={counts.mine} hint="responsável" icon="person_pin" tone="primary" />
          <Kpi
            label="SLA vencido"
            value={overview.data?.tickets.overdue}
            hint="atenção"
            icon="timer"
            tone="danger"
          />
          <Kpi label="Aguardando cliente" value={counts.waiting} hint="SLA pausado" icon="hourglass_top" />
          <Kpi label="Em triagem" value={counts.triage} hint="sem cliente" icon="inbox" />
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm">
        {summary && (
          <Tabs
            value={view}
            onChange={(v) => {
              setView(v as View);
              patch({ page: 1 });
            }}
            tabs={[
              { value: 'all', label: 'Todas', count: counts.all },
              { value: 'mine', label: 'Minhas', count: counts.mine },
              { value: 'overdue', label: 'SLA vencido', count: counts.overdue, tone: 'danger' },
              { value: 'waiting', label: 'Aguardando cliente', count: counts.waiting },
              { value: 'triage', label: 'Triagem', count: counts.triage },
            ]}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-muted-foreground"
            />
            <Input
              placeholder="Buscar por número ou título"
              className="w-64 bg-muted pl-8"
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') patch({ q: qText.trim() || undefined });
              }}
            />
          </div>
          <Select
            className="w-40"
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
            className="w-40"
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
            className="w-40"
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
            className="w-44"
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
              className="w-44"
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
          {!summary && (
            <>
              <label className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={!!filters.overdue}
                  onChange={(e) => patch({ overdue: e.target.checked })}
                />
                Só vencidos
              </label>
              <label className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={!!filters.needsTriage}
                  onChange={(e) => patch({ needsTriage: e.target.checked })}
                />
                Só triagem
              </label>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-card shadow-sm">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/60 text-left text-muted-foreground">
            <tr>
              <th className="label-mono px-4 py-3">Nº OS</th>
              <th className="label-mono px-4 py-3">Assunto</th>
              <th className="label-mono px-4 py-3">Cliente</th>
              <th className="label-mono px-4 py-3">Responsável</th>
              <th className="label-mono px-4 py-3">Prioridade</th>
              <th className="label-mono px-4 py-3">Status</th>
              <th className="label-mono px-4 py-3">SLA restante</th>
              <th className="label-mono px-4 py-3">Criado em</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-destructive-foreground">
                  Erro ao carregar chamados.
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhum chamado encontrado.
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const late = isOverdue(t);
              const assignee = t.assigneeId ? agentName.get(t.assigneeId) : undefined;
              return (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/app/chamados/${t.id}`)}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-accent"
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-primary">
                      {late && <Icon name="emergency_home" className="text-[16px] text-destructive-foreground" />}
                      {t.number}
                    </span>
                  </td>
                  <td className="max-w-[22rem] px-4 py-3 font-medium">{t.title}</td>
                  <td className="px-4 py-3">{t.clientId ? clientName.get(t.clientId) ?? '—' : '—'}</td>
                  <td className="px-4 py-3">
                    {assignee ? (
                      <span className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded bg-info text-[10px] font-bold text-info-foreground">
                          {initials(assignee)}
                        </span>
                        {assignee}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={PRIORITY_TONE[t.priority]}
                      dot={t.priority === 'URGENT' || t.priority === 'HIGH'}
                      className={t.priority === 'URGENT' ? 'bg-destructive-foreground text-white' : undefined}
                    >
                      {PRIORITY_LABELS[t.priority]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[t.status]} dot>
                        {STATUS_LABELS[t.status]}
                      </Badge>
                      {late && <Badge tone="red">vencido</Badge>}
                      {t.needsTriage && <Badge tone="amber">triagem</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <SlaIndicator slaDueAt={t.slaDueAt} status={t.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(t.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[13px] text-muted-foreground">
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
