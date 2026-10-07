'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import {
  STATUS_LABELS,
  useTickets,
  type TicketFilters,
  type TicketStatus,
} from '@/lib/tickets';
import { cn } from '@/lib/utils';
import { TicketProgress } from '@/components/ticket-progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_TONE = {
  OPEN: 'blue',
  IN_PROGRESS: 'blue',
  WAITING_CLIENT: 'amber',
  RESOLVED: 'green',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
} as const;

function Kpi({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: number | undefined;
  hint: string;
  icon: string;
  tone?: 'default' | 'attention';
}) {
  const attention = tone === 'attention' && !!value;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="label-mono text-muted-foreground">{label}</span>
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            attention ? 'bg-warning text-warning-foreground' : 'bg-info text-info-foreground',
          )}
        >
          <Icon name={icon} className="text-[18px]" />
        </span>
      </div>
      <div className="flex flex-col">
        <span className={cn('text-[28px] font-semibold leading-9 tracking-tight', attention && 'text-warning-foreground')}>
          {value ?? '—'}
        </span>
        <span className="text-[12px] text-muted-foreground">{hint}</span>
      </div>
    </div>
  );
}

// Lista de chamados do cliente. O backend já escopa por papel (CONTACT: os seus;
// MANAGER: todos da empresa), então o front não filtra por solicitante.
export default function PortalHomePage() {
  const router = useRouter();
  const { user } = useSession();
  const [filters, setFilters] = useState<TicketFilters>({ page: 1, pageSize: 20 });
  const [qText, setQText] = useState('');
  const { data, isLoading, isError } = useTickets(filters);

  const active = useTickets({ active: true, page: 1, pageSize: 3 });
  const waiting = useTickets({ status: 'WAITING_CLIENT', page: 1, pageSize: 1 });
  const resolved = useTickets({ status: 'RESOLVED', page: 1, pageSize: 1 });
  const closed = useTickets({ status: 'CLOSED', page: 1, pageSize: 1 });
  const doneTotal =
    resolved.data && closed.data ? resolved.data.total + closed.data.total : undefined;

  function patch(p: Partial<TicketFilters>) {
    setFilters((f) => ({ ...f, ...p, page: p.page ?? 1 }));
  }

  const rows = data?.data ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = filters.page ?? 1;
  const firstName = user?.name.split(' ')[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="label-mono text-primary">Painel exclusivo do cliente</span>
          <h1 className="text-[28px] font-semibold leading-9">Meus chamados</h1>
          <p className="text-[13px] text-muted-foreground">
            {firstName ? `Olá, ${firstName}. ` : ''}Acompanhe aqui o andamento de cada solicitação.
          </p>
        </div>
        <Button
          className="flex items-center gap-1.5 self-start md:self-auto"
          onClick={() => router.push('/portal/chamados/novo')}
        >
          <Icon name="add_circle" className="text-[18px]" />
          Abrir chamado
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Em aberto" value={active.data?.total} hint="chamados em atendimento" icon="confirmation_number" />
        <Kpi
          label="Aguardando sua resposta"
          value={waiting.data?.total}
          hint="precisam de uma ação sua"
          icon="hourglass_top"
          tone="attention"
        />
        <Kpi label="Resolvidos" value={doneTotal} hint="resolvidos ou fechados" icon="task_alt" />
      </div>

      {active.data && active.data.data.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <Icon name="sync" className="text-[20px] text-primary" />
            Em andamento
          </h2>
          <ul className="flex flex-col gap-3">
            {active.data.data.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/portal/chamados/${t.id}`)}
                  className="flex w-full flex-col gap-4 rounded-xl bg-card p-5 text-left shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="label-mono rounded bg-info px-2 py-1 font-mono text-info-foreground">
                      {t.number}
                    </span>
                    <Badge tone={STATUS_TONE[t.status]} dot>
                      {STATUS_LABELS[t.status]}
                    </Badge>
                    <span className="ml-auto text-[12px] text-muted-foreground">
                      Aberto em {fmtDate(t.createdAt)}
                    </span>
                  </div>
                  <span className="text-[16px] font-semibold leading-6">{t.title}</span>
                  <TicketProgress status={t.status} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[16px] font-semibold">Histórico de chamados</h2>

        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-4 shadow-sm">
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
            className="w-48"
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
        </div>

        <div className="overflow-x-auto rounded-xl bg-card shadow-sm">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="label-mono px-4 py-3">Número</th>
                <th className="label-mono px-4 py-3">Título</th>
                <th className="label-mono px-4 py-3">Status</th>
                <th className="label-mono px-4 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-destructive-foreground">
                    Erro ao carregar chamados.
                  </td>
                </tr>
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    Nenhum chamado encontrado.
                  </td>
                </tr>
              )}
              {rows.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/portal/chamados/${t.id}`)}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-accent"
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] font-semibold text-primary">
                    {t.number}
                  </td>
                  <td className="px-4 py-3 font-medium">{t.title}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[t.status]} dot>
                      {STATUS_LABELS[t.status]}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {fmtDate(t.createdAt)}
                  </td>
                </tr>
              ))}
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
      </section>
    </div>
  );
}
