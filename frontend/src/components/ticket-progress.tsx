import type { TicketStatus } from '@/lib/tickets';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';

const STEPS = ['Recebido', 'Técnico atribuído', 'Em execução', 'Validação', 'Concluído'];

// Chamado em andamento já tem técnico (passo 1 cumprido); aguardando cliente fica em execução, pausado.
const CURRENT: Record<TicketStatus, number> = {
  OPEN: 0,
  IN_PROGRESS: 2,
  WAITING_CLIENT: 2,
  RESOLVED: 3,
  CLOSED: 5,
  CANCELLED: -1,
};

/** Linha de progresso do chamado para o cliente. */
export function TicketProgress({ status }: { status: TicketStatus }) {
  if (status === 'CANCELLED') {
    return <p className="text-[12px] text-muted-foreground">Chamado cancelado.</p>;
  }
  const current = CURRENT[status];
  return (
    <ol className="flex items-start" aria-label="Progresso do chamado">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
            {i > 0 && (
              <span
                className={cn(
                  'absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2',
                  i <= current ? 'bg-primary' : 'bg-accent',
                )}
              />
            )}
            <span
              className={cn(
                'relative z-10 flex h-7 w-7 items-center justify-center rounded-full',
                done && 'bg-primary text-primary-foreground',
                active && 'bg-card text-primary ring-2 ring-primary',
                !done && !active && 'bg-accent text-muted-foreground',
              )}
            >
              <Icon
                name={done ? 'check' : active ? (status === 'WAITING_CLIENT' ? 'pause' : 'sync') : 'circle'}
                className={cn('text-[16px]', !done && !active && 'text-[8px]')}
              />
            </span>
            <span
              className={cn(
                'text-[11px] leading-tight',
                active ? 'font-semibold text-primary' : done ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
