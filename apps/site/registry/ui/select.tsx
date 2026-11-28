'use client'

import * as React from 'react'
import { cn } from 'cn'
import {
  Select as SelectPrimitive,
  SelectContent as SelectContentPrimitive,
  SelectGroup as SelectGroupPrimitive,
  SelectGroupLabel,
  SelectItem as SelectItemPrimitive,
  SelectItemIndicator,
  SelectItemText,
  SelectSeparator as SelectSeparatorPrimitive,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue as SelectValuePrimitive,
  type SelectProps as SelectPrimitiveProps,
} from '@ui-sdk/react/select'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'

type WithClassName<T extends React.ElementType> = Omit<React.ComponentProps<T>, 'className'> & {
  className?: string
}
type Composed<T extends React.ElementType> = Omit<WithClassName<T>, 'children'> & {
  children?: React.ReactNode
}

type SelectProps = Omit<
  SelectPrimitiveProps<string, false>,
  'value' | 'defaultValue' | 'onValueChange' | 'multiple'
> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

/** Single string value, like the Radix select it replaced: clearing reports ''. */
function Select({ value, defaultValue, onValueChange, ...props }: SelectProps) {
  return (
    <SelectPrimitive
      value={value === undefined ? undefined : value || null}
      defaultValue={defaultValue === undefined ? undefined : defaultValue || null}
      onValueChange={(next) => onValueChange?.(next ?? '')}
      {...props}
    />
  )
}

function SelectGroup({ className, ...props }: WithClassName<typeof SelectGroupPrimitive>) {
  return <SelectGroupPrimitive className={cn('scroll-my-1 p-1', className)} {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectValuePrimitive>) {
  return <SelectValuePrimitive {...props} />
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: Composed<typeof SelectTriggerPrimitive> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectTriggerPrimitive
      data-size={size}
      className={cn(
        "flex h-10 w-full items-center justify-between gap-1.5 rounded-full border border-input bg-transparent px-4 py-2 text-base transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=sm]:h-8 data-[size=sm]:w-auto data-[size=sm]:px-3 data-[size=sm]:text-xs md:text-sm *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate *:data-[slot=select-value]:text-left [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none size-4 text-muted-foreground"
      />
    </SelectTriggerPrimitive>
  )
}

function SelectContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: WithClassName<typeof SelectContentPrimitive>) {
  return (
    <SelectContentPrimitive
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'relative z-50 m-0 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )}
      {...props}
    />
  )
}

function SelectLabel({ className, ...props }: WithClassName<typeof SelectGroupLabel>) {
  return (
    <SelectGroupLabel
      className={cn('px-1.5 py-1 text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: Composed<typeof SelectItemPrimitive>) {
  return (
    <SelectItemPrimitive
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-lg py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectItemIndicator>
      </span>
      <SelectItemText>{children}</SelectItemText>
    </SelectItemPrimitive>
  )
}

function SelectSeparator({ className, ...props }: WithClassName<typeof SelectSeparatorPrimitive>) {
  return (
    <SelectSeparatorPrimitive
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
