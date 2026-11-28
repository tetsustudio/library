import * as React from 'react'
import { cn } from 'cn'
import { Input as InputPrimitive } from '@ui-sdk/react/input'

type InputProps = Omit<React.ComponentProps<typeof InputPrimitive>, 'className'> & {
  className?: string
}

function Input({ className, ...props }: InputProps) {
  return (
    <InputPrimitive
      className={cn(
        'h-10 w-full min-w-0 rounded-full border border-input bg-transparent px-4 py-2 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
