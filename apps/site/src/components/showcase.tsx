'use client'

import { useState, type ReactNode } from 'react'
import { MailIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { CopyCommand } from './copy-command'

function Item({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section id={name} className="flex flex-col gap-4 rounded-lg border border-border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-lg font-semibold">{name}</h3>
        <a className="font-mono text-xs text-muted-foreground hover:text-foreground" href={`/r/${name}.json`}>
          /r/{name}.json
        </a>
      </div>
      <div className="flex min-h-24 flex-wrap items-center gap-3">{children}</div>
      <CopyCommand command={`npx shadcn@latest add https://library.tetsustudio.com/r/${name}.json`} />
    </section>
  )
}

export function Showcase() {
  const [role, setRole] = useState('editor')
  const [open, setOpen] = useState(false)
  const [notify, setNotify] = useState(true)

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Item name="button">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Delete</Button>
      </Item>

      <Item name="input">
        <Input placeholder="Email address" type="email" className="max-w-xs" />
      </Item>

      <Item name="input-group">
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search" />
        </InputGroup>
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <MailIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="you@example.com" />
        </InputGroup>
      </Item>

      <Item name="textarea">
        <Textarea placeholder="Write a note" className="max-w-sm" />
      </Item>

      <Item name="label">
        <div className="flex flex-col gap-2">
          <Label htmlFor="demo-name">Name</Label>
          <Input id="demo-name" placeholder="Ada Lovelace" className="max-w-xs" />
        </div>
      </Item>

      <Item name="switch">
        <div className="flex items-center gap-3">
          <Switch id="demo-switch" checked={notify} onCheckedChange={setNotify} />
          <Label htmlFor="demo-switch">Email me when something changes</Label>
        </div>
      </Item>

      <Item name="select">
        <Select value={role} onValueChange={(v) => setRole(String(v))}>
          <SelectTrigger aria-label="Role" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">Viewer</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </Item>

      <Item name="popover">
        <Popover>
          <PopoverTrigger render={<Button variant="outline" />}>Show details</PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Deploy</PopoverTitle>
              <PopoverDescription>Last deploy finished 4 minutes ago.</PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </Item>

      <Item name="dialog">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archive project</DialogTitle>
              <DialogDescription>You can restore it from Settings for 30 days.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setOpen(false)}>Archive</Button>
            </div>
          </DialogContent>
        </Dialog>
      </Item>

      <Item name="dropdown-menu">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>Open menu</DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Delete account</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Item>

      <Item name="command">
        <div className="w-full max-w-sm overflow-hidden rounded-lg border border-border">
          <Command onAction={(value) => toast(`Command: ${String(value)}`)}>
            <CommandInput aria-label="Search commands" placeholder="Search commands…" />
            <CommandList>
              <CommandGroup heading="Project">
                <CommandItem value="new">New project</CommandItem>
                <CommandItem value="import">Import</CommandItem>
              </CommandGroup>
              <CommandGroup heading="Account">
                <CommandItem value="billing">Billing</CommandItem>
              </CommandGroup>
            </CommandList>
            <CommandEmpty>No results.</CommandEmpty>
          </Command>
        </div>
      </Item>

      <Item name="calendar">
        <Calendar />
      </Item>

      <Item name="table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>storage</TableCell>
              <TableCell>Healthy</TableCell>
              <TableCell className="text-right font-mono">42 ms</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>mail</TableCell>
              <TableCell>Degraded</TableCell>
              <TableCell className="text-right font-mono">310 ms</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Item>

      <Item name="pagination">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#pagination" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#pagination">1</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#pagination" isActive>
                2
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#pagination" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </Item>

      <Item name="skeleton">
        <div className="flex w-full max-w-sm items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      </Item>

      <Item name="toast">
        <Button variant="secondary" onClick={() => toast.success?.('Saved') ?? toast('Saved')}>
          Show toast
        </Button>
        <Button variant="outline" onClick={() => toast.error?.('Could not save') ?? toast('Could not save')}>
          Show error
        </Button>
      </Item>
    </div>
  )
}
