import * as React from 'react';
import { cn } from '@/lib/utils';

// ponytail: botão mínimo; substituir por shadcn quando o registry estiver acessível
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';
    const variants = {
      default: 'bg-black text-white hover:bg-black/80',
      outline: 'border border-input hover:bg-accent',
      ghost: 'hover:bg-accent',
    };
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
