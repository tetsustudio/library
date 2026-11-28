import * as React from 'react'
import { cn } from 'cn'
import { Label as LabelPrimitive } from '@ui-sdk/react/label'

type LabelProps = Omit<React.ComponentProps<typeof LabelPrimitive>, 'className'> & {
  className?: string
}

function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium text-muted-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-data-disabled:cursor-not-allowed peer-data-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
