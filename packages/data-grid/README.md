# @tetsustudio/data-grid

One data set, two views: a **table** (`DataTable`) for browsing and a
collaborative **spreadsheet** (`DataGrid`, on
[Glide Data Grid](https://github.com/glideapps/glide-data-grid)) for editing,
switched by `DataView`. The sheet is driven by a store (`createGridStore`) that
talks to your app only through adapters: `transport`, `realtime` and `notify`.

No router, no `next/*`, no env vars, no Tailwind. Styling reads the CSS
variables of [`@tetsustudio/tokens`](../tokens).

## Install

```sh
npm install @tetsustudio/data-grid @glideapps/glide-data-grid@6.0.4-alpha24 zustand
```

Peer dependencies: `react` and `react-dom` ^19, `@glideapps/glide-data-grid`
^6.0.4-alpha24 (npm also installs Glide's own peers: `lodash`, `marked`,
`react-responsive-carousel`), `zustand` ^5, and optionally
`@tetsustudio/tokens` ^0.1.0 for theming.

Import the CSS once (it already contains Glide's CSS):

```ts
import '@tetsustudio/data-grid/styles.css';
```

## Minimal example

```tsx
'use client';
import { useState } from 'react';
import {
  createGridStore, GridConflictError, GridSheet, DataTable, DataView,
  type GridColumnDef, type DataViewMode,
} from '@tetsustudio/data-grid';

type Provider = { id: number; version: number; name: string; phone: string | null };
type Field = 'name' | 'phone';

const columns: GridColumnDef<Field>[] = [
  { field: 'name', title: 'Name *', width: 220, kind: 'text', required: true },
  { field: 'phone', title: 'Phone', width: 160, kind: 'text' },
];

// A fake in-memory backend; yours calls fetch().
let db: Provider[] = [{ id: 1, version: 1, name: 'Molino', phone: null }];
let nextId = 2;

const useProviders = createGridStore<Provider, Field>({
  columns,
  emptyOptions: {},
  rowFromApi: (p) => ({ key: String(p.id), id: p.id, version: p.version, values: { name: p.name, phone: p.phone } }),
  transport: {
    fetchAll: async () => ({ rows: db, options: {} }),
    patch: async ({ id, field, value, version }) => {
      const row = db.find((r) => r.id === id)!;
      if (row.version !== version) throw new GridConflictError(row);
      const saved = { ...row, [field]: value, version: row.version + 1 };
      db = db.map((r) => (r.id === id ? saved : r));
      return saved;
    },
    batch: async (_scopeId, rows) => ({
      results: rows.map((r, index) => {
        const row = { id: r.id ?? nextId++, version: (r.version ?? 0) + 1, name: '', phone: null, ...r.values } as Provider;
        db = r.id ? db.map((x) => (x.id === r.id ? row : x)) : [...db, row];
        return { index, status: r.id ? 'updated' : 'created', row };
      }),
    }),
    delete: async (ids) => { db = db.filter((r) => !ids.includes(r.id)); },
  },
  notify: { success: console.log, error: console.error },
});

export function Providers() {
  const [view, setView] = useState<DataViewMode>('table');
  return (
    <DataView
      view={view}
      onViewChange={setView}
      table={<DataTable data={db} columns={[{ header: 'Name', accessor: 'name' }]} />}
      sheet={<GridSheet store={useProviders} scopeId={1} columns={columns} />}
    />
  );
}
```

`GridSheet` loads the scope on mount, joins its realtime room, shares the cursor
and resets on unmount. Use `DataGrid` directly when you want to wire the store
yourself (it is fully presentational).

## Adapters

```ts
interface GridTransport<A, F> {
  fetchAll(scopeId): Promise<{ rows: A[]; options: GridOptions; notice?: string | null }>;
  patch({ id, field, value, version, base }): Promise<A | void>; // throw GridConflictError(current) on a stale version
  batch(scopeId, rows: BatchRow<F>[]): Promise<{ results: BatchResult<A>[]; created?; updated?; failed? }>;
  delete?(ids: number[]): Promise<unknown>; // absent = rows cannot be deleted
}

interface GridRealtime<A> {
  subscribe(scopeId, emit: (event: GridRealtimeEvent<A>) => void): () => void;
  sendCursor?(cursor: PresenceCursor | null): void;
}
// events: { type: 'status', status: 'connecting' | 'open' | 'closed' }
//         { type: 'rows', rows }       remote changes (older versions are ignored)
//         { type: 'removed', ids }     rows that left this user's scope
//         { type: 'presence', members, connId? }
//         { type: 'error', message }   goes to notify.error

interface GridNotify { success(msg): void; error(msg): void; warning?(msg): void }
```

- Rows (`A`) need `id` and `version`; every save sends the version and the cell
  value the user saw (`base`), so the server can detect conflicts.
- Every edit is optimistic: it shows at once, rolls back on error, and the error
  shows on the cell and through `notify.error`.
- Emit `status: 'open'` on every (re)connect: after the first one the store
  reloads to catch up.
- `errorMessage(error)` turns a thrown error into the text shown (e.g. map a 403
  to "you cannot edit this row"). `messages` overrides the store's texts.
- Without `realtime` the sheet works single-user (`connection: 'none'`).

## Switching views

`DataView` is controlled (`view`, `onViewChange`) and only mounts the active
view. Keep the mode wherever you like; for a URL param:

```tsx
const params = useSearchParams();               // next/navigation, react-router...
const view = params.get('vista') === 'planilla' ? 'sheet' : 'table';
const onViewChange = (v) => router.replace(v === 'sheet' ? '?vista=planilla' : '?');
```

## Theming

Colors and fonts come from the token variables in scope of the grid:
`--background`, `--foreground`, `--surface`, `--border`, `--brand`,
`--brand-foreground`, `--muted-foreground`, `--accent`, `--destructive`,
`--warning`, `--font-sans`. The sheet resolves them in the browser (so
`color-mix()` and `oklch()` work) into the plain colors Glide's canvas needs, and
recomputes when `class`, `style`, `data-style` or `data-theme` changes on
`<html>`/`<body>`. Override any Glide theme key with the `theme` prop:

```tsx
<GridSheet theme={{ accentColor: '#e11d48', rowHeight: 40 }} ... />
```

## Glide's portal

Glide renders cell editors into `#portal`. The sheet creates it on `<body>` when
missing; to place it yourself (e.g. in a Next.js root layout) render
`<GridPortal />`.

## Text and keyboard

UI texts default to Spanish (es-AR), as in the app this comes from; pass
`labels` to `DataGrid`/`GridSheet`/`DataTable`/`DataView` and `messages` to the
store to change them. The pure model (`parseCellInput`, `parseDateInput`,
`planPaste`…) keeps its Spanish validation messages and dd/mm/yyyy dates.

Sheet keys: type to edit, F2/Enter/Space open the editor, Tab/Enter confirm and
move, Esc cancels, Ctrl+C/Ctrl+V copy and paste blocks from Excel/Sheets,
Ctrl+Z undoes the last saved cell, Ctrl+Delete deletes the selected rows after
a confirmation.

## Entry points

| Import | What |
| --- | --- |
| `@tetsustudio/data-grid` | everything (client components) |
| `@tetsustudio/data-grid/model` | pure grid model, no React |
| `@tetsustudio/data-grid/store` | `createGridStore` and adapter types |
| `@tetsustudio/data-grid/styles.css` | Glide CSS + table/sheet styles |

MIT © Tetsu Studio
