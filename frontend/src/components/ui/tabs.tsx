'use client';

import { cn } from '@/lib/utils';

// ponytail: abas controladas mínimas — o pai guarda o estado com useState.
// `count` opcional mostra o contador entre parênteses; `tone="danger"` destaca a aba (ex.: SLA em risco).
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: string; count?: number; tone?: 'danger' }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              'label-mono rounded-full px-3 py-1.5 transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : t.tone === 'danger'
                  ? 'bg-destructive text-destructive-foreground hover:opacity-80'
                  : 'bg-info text-info-foreground hover:opacity-80',
            )}
          >
            {t.label}
            {t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        );
      })}
    </div>
  );
}
