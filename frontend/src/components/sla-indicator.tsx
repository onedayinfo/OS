import { TERMINAL_STATUSES, type TicketStatus } from '@/lib/tickets';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';

export function fmtDuration(ms: number): string {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** SLA restante: pausado quando aguardando cliente, vermelho se vencido ou a menos de 2h. */
export function SlaIndicator({
  slaDueAt,
  status,
  className,
}: {
  slaDueAt: string | null;
  status: TicketStatus;
  className?: string;
}) {
  if (!slaDueAt || TERMINAL_STATUSES.includes(status)) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (status === 'WAITING_CLIENT') {
    return (
      <span className={cn('flex items-center gap-1 text-muted-foreground', className)} title="SLA pausado">
        <Icon name="pause_circle" className="text-[16px]" />
        Pausado
      </span>
    );
  }
  const ms = new Date(slaDueAt).getTime() - Date.now();
  const late = ms < 0;
  const risk = !late && ms < 2 * 3_600_000;
  return (
    <span
      className={cn(
        'flex items-center gap-1 whitespace-nowrap font-medium',
        late || risk ? 'text-destructive-foreground' : 'text-muted-foreground',
        className,
      )}
      title={new Date(slaDueAt).toLocaleString('pt-BR')}
    >
      <Icon name={late ? 'alarm' : 'schedule'} className="text-[16px]" />
      {late ? `vencido há ${fmtDuration(ms)}` : fmtDuration(ms)}
    </span>
  );
}
