'use client'

import * as React from 'react'
import { cn } from 'cn'
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '@ui-sdk/react/menu'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'

type WithClassName<T extends React.ElementType> = Omit<React.ComponentProps<T>, 'className'> & {
  className?: string
}
type Composed<T extends React.ElementType> = Omit<WithClassName<T>, 'children'> & {
  children?: React.ReactNode
}

const contentClasses =
  'z-50 m-0 min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95'

const itemClasses =
  "relative flex cursor-default items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

function DropdownMenu(props: React.ComponentProps<typeof Menu>) {
  return <Menu {...props} />
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof MenuTrigger>) {
  return <MenuTrigger {...props} />
}

function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: WithClassName<typeof MenuContent>) {
  return (
    <MenuContent
      align={align}
      sideOffset={sideOffset}
      className={cn('max-h-(--available-height)', contentClasses, className)}
      {...props}
    />
  )
}

function DropdownMenuGroup(props: React.ComponentProps<typeof MenuGroup>) {
  return <MenuGroup {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: WithClassName<typeof MenuItem> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <MenuItem
      data-inset={inset || undefined}
      data-variant={variant}
      destructive={variant === 'destructive' || undefined}
      className={cn(
        itemClasses,
        'group/dropdown-menu-item data-destructive:text-destructive data-destructive:data-highlighted:bg-destructive/10 data-destructive:data-highlighted:text-destructive dark:data-destructive:data-highlighted:bg-destructive/20 data-destructive:*:[svg]:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  inset,
  ...props
}: Composed<typeof MenuCheckboxItem> & {
  inset?: boolean
}) {
  return (
    <MenuCheckboxItem
      data-inset={inset || undefined}
      className={cn(itemClasses, 'rounded-md pr-8', className)}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <MenuItemIndicator>
          <CheckIcon />
        </MenuItemIndicator>
      </span>
      {children}
    </MenuCheckboxItem>
  )
}

function DropdownMenuRadioGroup(props: React.ComponentProps<typeof MenuRadioGroup>) {
  return <MenuRadioGroup {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: Composed<typeof MenuRadioItem> & {
  inset?: boolean
}) {
  return (
    <MenuRadioItem
      data-inset={inset || undefined}
      className={cn(itemClasses, 'rounded-md pr-8', className)}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <MenuItemIndicator>
          <CheckIcon />
        </MenuItemIndicator>
      </span>
      {children}
    </MenuRadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: WithClassName<typeof MenuGroupLabel> & {
  inset?: boolean
}) {
  return (
    <MenuGroupLabel
      data-inset={inset || undefined}
      className={cn(
        'px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: WithClassName<typeof MenuSeparator>) {
  return <MenuSeparator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'ml-auto text-xs tracking-widest text-muted-foreground group-data-highlighted/dropdown-menu-item:text-accent-foreground',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSub(props: React.ComponentProps<typeof MenuSub>) {
  return <MenuSub {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: Composed<typeof MenuSubTrigger> & {
  inset?: boolean
}) {
  return (
    <MenuSubTrigger
      data-inset={inset || undefined}
      className={cn(
        itemClasses,
        'rounded-md data-open:bg-accent data-open:text-accent-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuSubTrigger>
  )
}

function DropdownMenuSubContent({ className, ...props }: WithClassName<typeof MenuSubContent>) {
  return <MenuSubContent className={cn(contentClasses, className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
