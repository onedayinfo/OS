import { cn } from '@/lib/utils';

/** Ícone Material Symbols (fonte carregada no layout raiz). Decorativo por padrão. */
export function Icon({
  name,
  className,
  filled,
}: {
  name: string;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn('material-symbols-outlined', className)}
      style={filled ? { fontVariationSettings: '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24' } : undefined}
    >
      {name}
    </span>
  );
}
