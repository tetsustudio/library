import * as React from 'react'
import { cn } from 'cn'
import { Switch as SwitchPrimitive, SwitchThumb } from '@ui-sdk/react/switch'

type SwitchProps = Omit<React.ComponentProps<typeof SwitchPrimitive>, 'className' | 'children'> & {
  className?: string
}

function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive
      className={cn(
        'peer group/switch relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-brand data-disabled:cursor-not-allowed data-disabled:opacity-50 data-unchecked:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchThumb className="pointer-events-none block h-4 w-4 translate-x-1 rounded-full bg-(--switch-thumb-off) ring-0 transition-transform data-checked:translate-x-6 data-checked:bg-(--switch-thumb-on)" />
    </SwitchPrimitive>
  )
}

export { Switch }
