import type { ButtonHTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

/**
 * The subset of glimpse's shadcn Button the reader uses: same classes, plain
 * `<button>` (no base-ui, no cva). tailwind-merge stays: callers override
 * size and padding (`h-9 w-9 p-0`), and without it both sets would apply.
 */
const BASE =
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

const VARIANTS = {
  default: 'bg-primary text-primary-foreground',
  outline:
    'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
  ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
} as const

const SIZE = 'h-8 gap-1.5 px-2.5'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS
}

export function Button({ className, variant = 'default', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      type={type}
      className={twMerge(BASE, VARIANTS[variant], SIZE, className)}
      {...props}
    />
  )
}
