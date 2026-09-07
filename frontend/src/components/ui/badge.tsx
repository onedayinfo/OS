import * as React from 'react';
import { cn } from '@/lib/utils';

// ponytail: badge só com as tonalidades que as telas usam.
type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

const TONES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
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
