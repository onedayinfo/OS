'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useDashboardOverview } from '@/lib/dashboard';
import { useTickets, type Paged } from '@/lib/tickets';
import { cn } from '@/lib/utils';
import { SlaIndicator } from '@/components/sla-indicator';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Panel } from '@/components/ui/panel';

function Kpi({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint: string;
  icon: string;
  tone?: 'default' | 'danger';
}) {
  const danger = tone === 'danger';
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className={cn('label-mono', danger ? 'text-destructive-foreground' : 'text-muted-foreground')}>
          {label}
        </span>
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            danger ? 'bg-destructive text-destructive-foreground' : 'bg-info text-info-foreground',
          )}
        >
          <Icon name={icon} className="text-[18px]" />
        </span>
      </div>
      <div className="flex flex-col">
        <span className={cn('text-[28px] font-semibold leading-9 tracking-tight', danger && 'text-destructive-foreground')}>
          {value}
        </span>
        <span className="text-[12px] text-muted-foreground">{hint}</span>
      </div>
    </div>
  );
}

const fmtMoney = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function DashboardPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, isFetching } = useDashboardOverview();
  const { data: critical } = useTickets({ overdue: true, page: 1, pageSize: 5 });
  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });
  const clientName = useMemo(() => {
    const m = new Map<string, string>();
    clients?.data.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [clients]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !data) return <p className="text-sm text-destructive-foreground">Não foi possível carregar o dashboard.</p>;

  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const totalOrigin = data.tickets.recurring + data.tickets.standalone;
  const recurringPct = totalOrigin ? (data.tickets.recurring / totalOrigin) * 100 : 0;
  const maxResolved = Math.max(1, ...data.technicianProductivity.map((t) => t.ticketsResolved));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="label-mono text-primary">Centro de operações</span>
          <h1 className="text-[24px] font-semibold leading-8">Dashboard</h1>
          <p className="text-[12px] text-muted-foreground">
            Período: {fmtDay(data.period.start)} a {fmtDay(data.period.end)}
          </p>
        </div>
        <Button
          variant="outline"
          className="flex items-center gap-1.5"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['dashboard-overview'] });
            qc.invalidateQueries({ queryKey: ['tickets'] });
          }}
        >
          <Icon name="refresh" className={cn('text-[18px]', isFetching && 'animate-spin')} />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Chamados abertos" value={String(data.tickets.open)} hint="na fila agora" icon="confirmation_number" />
        <Kpi
          label="Chamados vencidos"
          value={String(data.tickets.overdue)}
          hint="SLA estourado"
          icon="alarm"
          tone={data.tickets.overdue > 0 ? 'danger' : 'default'}
        />
        <Kpi
          label="Tempo médio de atendimento"
          value={
            data.avgResolutionHours != null
              ? `${data.avgResolutionHours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
              : '—'
          }
          hint="média de resolução no período"
          icon="timer"
        />
        <Kpi
          label="Margem do mês"
          value={fmtMoney(data.margin.totalMargin)}
          hint={`${data.margin.ticketsCount} chamado(s) com custo e receita`}
          icon="payments"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel
          title="Chamados com SLA crítico"
          icon="emergency_home"
          action={
            <Link href="/app" className="text-[12px] font-semibold text-primary hover:underline">
              Ver fila completa
            </Link>
          }
        >
          {critical && critical.data.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nenhum chamado com SLA estourado. Tudo em dia.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="label-mono py-2 pr-3">Nº OS</th>
                    <th className="label-mono py-2 pr-3">Cliente</th>
                    <th className="label-mono py-2 pr-3">Assunto</th>
                    <th className="label-mono py-2 pr-3">SLA</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {critical?.data.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-[12px] font-semibold text-primary">
                        {t.number}
                      </td>
                      <td className="py-2.5 pr-3">{t.clientId ? clientName.get(t.clientId) ?? '—' : '—'}</td>
                      <td className="max-w-[16rem] truncate py-2.5 pr-3">{t.title}</td>
                      <td className="py-2.5 pr-3">
                        <SlaIndicator slaDueAt={t.slaDueAt} status={t.status} />
                      </td>
                      <td className="py-2.5 text-right">
                        <Link
                          href={`/app/chamados/${t.id}`}
                          className="rounded-lg bg-destructive px-2.5 py-1 text-[12px] font-semibold text-destructive-foreground hover:opacity-80"
                        >
                          Intervir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Origem dos chamados" icon="donut_large">
          <div className="flex flex-col items-center gap-4">
            <div
              className="relative h-36 w-36 rounded-full"
              style={{
                background:
                  totalOrigin === 0
                    ? 'var(--accent)'
                    : `conic-gradient(var(--primary) 0 ${recurringPct}%, var(--info) ${recurringPct}% 100%)`,
              }}
            >
              <div className="absolute inset-4 flex flex-col items-center justify-center rounded-full bg-card">
                <span className="text-[24px] font-semibold leading-7">{totalOrigin}</span>
                <span className="label-mono text-muted-foreground">abertos</span>
              </div>
            </div>
            <ul className="flex w-full flex-col gap-1.5 text-[13px]">
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  Recorrente (contrato)
                </span>
                <strong>{data.tickets.recurring}</strong>
              </li>
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-info" />
                  Avulso
                </span>
                <strong>{data.tickets.standalone}</strong>
              </li>
            </ul>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Produtividade por técnico" icon="engineering">
          {data.technicianProductivity.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nenhuma atividade este mês.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.technicianProductivity.map((t) => (
                <li key={t.technicianId} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-muted-foreground">
                      {t.ticketsResolved} chamado(s) · {t.hoursWorked} h
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-accent">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(t.ticketsResolved / maxResolved) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Contratos com franquia estourada" icon="contract">
          {data.contractsExceeded.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nenhum contrato excedido este mês.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.contractsExceeded.map((c) => (
                <li
                  key={c.contractId}
                  className="flex items-center justify-between rounded-lg bg-warning px-3 py-2 text-[13px] text-warning-foreground"
                >
                  <span>
                    {c.clientName} — {c.name}
                  </span>
                  <span className="font-semibold">
                    {c.used}/{c.franchiseAmount} {c.unit === 'VISITS' ? 'visitas' : 'horas'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
