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
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
