import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';

/** Cartão de seção da ficha: título com ícone, ação opcional à direita e conteúdo. */
export function Panel({
  title,
  icon,
  action,
  children,
  className,
}: {
  title?: string;
  icon?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl bg-card p-5 shadow-sm', className)}>
      {title && (
        <div className="mb-3 flex items-center gap-2">
          {icon && <Icon name={icon} className="text-[20px] text-primary" />}
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
