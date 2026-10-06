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
      'inline-flex items-center justify-center rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50';
    const variants = {
      default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
      outline: 'bg-card shadow-sm hover:bg-accent hover:text-accent-foreground',
      ghost: 'hover:bg-accent hover:text-accent-foreground',
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
