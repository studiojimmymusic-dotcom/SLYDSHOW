import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'xs';

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-dark-text-on-accent hover:bg-accent-hover',
  secondary:
    'border border-border bg-background text-text-primary hover:border-text-tertiary hover:bg-surface',
  ghost: 'bg-transparent text-text-primary hover:bg-surface',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-9 px-4 text-[13px]',
  xs: 'h-8 px-3 text-[13px]',
};

export function Button({
  variant = 'primary',
  size = 'sm',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-button font-medium transition-[color,background-color,border-color] duration-[120ms] ease-out disabled:pointer-events-none disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}

export const fieldClassName =
  'h-9 w-full rounded-card border border-border bg-background px-3 text-[13px] text-text-primary transition-colors duration-[120ms] ease-out placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
