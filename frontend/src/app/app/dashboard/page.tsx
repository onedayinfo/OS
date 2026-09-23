'use client';

import { useDashboardOverview } from '@/lib/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-1">
        <CardTitle className="text-xs font-medium uppercase text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 text-2xl font-semibold">{value}</CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useDashboardOverview();

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !data) return <p className="text-sm text-destructive-foreground">Não foi possível carregar o dashboard.</p>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Chamados abertos" value={String(data.tickets.open)} />
        <KpiCard label="Chamados vencidos" value={String(data.tickets.overdue)} />
        <KpiCard
          label="Tempo médio de atendimento"
          value={data.avgResolutionHours != null ? `${data.avgResolutionHours}h` : '—'}
        />
        <KpiCard label="Margem do mês" value={`R$ ${data.margin.totalMargin.toFixed(2)}`} />
      </div>

      <div className="flex gap-6 text-sm">
        <span>
          Recorrente: <strong>{data.tickets.recurring}</strong>
        </span>
        <span>
          Avulso: <strong>{data.tickets.standalone}</strong>
        </span>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Produtividade por técnico</h2>
        {data.technicianProductivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma atividade este mês.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.technicianProductivity.map((t) => (
              <li key={t.technicianId} className="flex justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>{t.name}</span>
                <span className="text-muted-foreground">
                  {t.ticketsResolved} chamado(s) · {t.hoursWorked}h
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Contratos com franquia estourada</h2>
        {data.contractsExceeded.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum contrato excedido este mês.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.contractsExceeded.map((c) => (
              <li key={c.contractId} className="flex justify-between rounded-md border border-warning bg-warning px-3 py-2 text-sm">
                <span>{c.clientName} — {c.name}</span>
                <span>
                  {c.used}/{c.franchiseAmount} {c.unit === 'VISITS' ? 'visitas' : 'horas'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
