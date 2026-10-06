import * as React from 'react';
import { cn } from '@/lib/utils';

// ponytail: badge só com as tonalidades que as telas usam.
type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

const TONES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  blue: 'bg-info text-info-foreground',
  green: 'bg-success text-success-foreground',
  amber: 'bg-warning text-warning-foreground',
  red: 'bg-destructive text-destructive-foreground',
};

export function Badge({
  tone = 'neutral',
  dot,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        'label-mono inline-flex items-center gap-1 rounded px-1.5 py-0.5',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
