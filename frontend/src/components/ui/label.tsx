import * as React from 'react';
import { cn } from '@/lib/utils';

// ponytail: label mínimo, mesmo estilo enxuto dos outros ui/*
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-[12px] font-semibold leading-none', className)}
      {...props}
    />
  ),
);
Label.displayName = 'Label';
