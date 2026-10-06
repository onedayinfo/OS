'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDashboardOverview } from '@/lib/dashboard';
import { TicketTable } from '@/components/ticket-table';
import { NewTicketForm } from '@/components/new-ticket-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';

export default function AppQueuePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(false);
  const { data: overview } = useDashboardOverview();

  useEffect(() => {
    if (searchParams.get('novo') === '1') {
      setCreating(true);
      router.replace('/app');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-[24px] font-semibold leading-8">Fila de chamados</h1>
            {overview && (
              <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                <span className="label-mono text-primary">{overview.tickets.open} ativos</span>
              </span>
            )}
          </div>
          {overview && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              {overview.tickets.overdue > 0 ? (
                <span className="flex items-center gap-1 text-destructive-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground" />
                  <strong>{overview.tickets.overdue} com SLA vencido</strong>
                </span>
              ) : (
                <span>Nenhum chamado com SLA vencido</span>
              )}
              {overview.avgResolutionHours !== null && (
                <>
                  <span>•</span>
                  <span>
                    Tempo médio de resolução:{' '}
                    <strong className="font-semibold text-foreground">
                      {overview.avgResolutionHours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h
                    </strong>
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <Button onClick={() => setCreating(true)} className="flex items-center gap-1.5">
          <Icon name="add_circle" className="text-[18px]" />
          Novo chamado
        </Button>
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Novo chamado">
        <NewTicketForm
          onCreated={(id) => {
            setCreating(false);
            router.push(`/app/chamados/${id}`);
          }}
          onCancel={() => setCreating(false)}
        />
      </Dialog>

      <TicketTable summary />
    </div>
  );
}
