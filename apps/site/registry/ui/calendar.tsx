'use client'

import * as React from 'react'
import { cn } from 'cn'
import {
  Calendar as CalendarPrimitive,
  CalendarDay,
  CalendarGrid,
  CalendarHeading,
  CalendarNext,
  CalendarPrevious,
  CalendarWeekday,
  CalendarWeekdays,
  CalendarWeeks,
} from '@ui-sdk/react/calendar'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'

const navClass = cn(
  buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
  'data-disabled:pointer-events-none data-disabled:opacity-50',
)

const dayClass =
  'size-9 rounded-full p-0 text-center align-middle text-sm font-normal outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-outside:text-muted-foreground/60 data-today:font-semibold data-today:text-brand data-range-middle:rounded-none data-range-middle:bg-muted data-selected:bg-primary data-selected:text-primary-foreground data-range-middle:data-selected:bg-muted data-range-middle:data-selected:text-foreground data-disabled:pointer-events-none data-disabled:opacity-40 data-unavailable:line-through'

/**
 * Month heading, navigation and grid. Works inside Calendar and inside
 * DatePickerContent, which accepts the same parts.
 */
function CalendarBody({
  previousLabel = 'Previous month',
  nextLabel = 'Next month',
}: {
  previousLabel?: string
  nextLabel?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <CalendarPrevious aria-label={previousLabel} className={navClass}>
          <ChevronLeftIcon aria-hidden="true" />
        </CalendarPrevious>
        <CalendarHeading className="text-sm font-medium first-letter:uppercase" />
        <CalendarNext aria-label={nextLabel} className={navClass}>
          <ChevronRightIcon aria-hidden="true" />
        </CalendarNext>
      </div>
      <CalendarGrid className="border-separate border-spacing-0">
        <CalendarWeekdays>
          {(index) => (
            <CalendarWeekday
              index={index}
              className="size-9 text-xs font-normal text-muted-foreground capitalize"
            />
          )}
        </CalendarWeekdays>
        <CalendarWeeks>
          {(cell) => <CalendarDay value={cell.date} className={dayClass} />}
        </CalendarWeeks>
      </CalendarGrid>
    </div>
  )
}

type CalendarProps = Omit<
  React.ComponentProps<typeof CalendarPrimitive>,
  'className' | 'children'
> & {
  className?: string
  previousLabel?: string
  nextLabel?: string
}

function Calendar({ className, previousLabel, nextLabel, ...props }: CalendarProps) {
  return (
    <CalendarPrimitive className={cn('w-fit p-2', className)} {...props}>
      <CalendarBody previousLabel={previousLabel} nextLabel={nextLabel} />
    </CalendarPrimitive>
  )
}

export { Calendar, CalendarBody }
