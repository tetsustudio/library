# @tetsustudio/editor

A markdown editor for React on [Milkdown](https://milkdown.dev) 7: a
**collaborative** editor bound to a [Yjs](https://yjs.dev) document you provide
(`CollaborativeEditor`), the same editor without collaboration
(`MarkdownEditor`), a live **plain-text** markdown mode over the same document
(`PlainTextEditor`), a toolbar, find in document, collapsible headings, block
drag handles, CodeMirror code blocks, an image viewer and an
[nspell](https://github.com/wooorm/nspell) spellchecker for Spanish and English.

It talks to your app only through props and adapters: `uploadImage`,
`storage`, `dictionaryBaseUrl` and `labels`. The app owns the Yjs provider and
the transport. No router, no `next/*`, no env vars, no Tailwind. Styling reads
the CSS variables of [`@tetsustudio/tokens`](../tokens).

A server entry, `@tetsustudio/editor/server`, gives server code the same
schema with no DOM and no React: parse and serialize markdown, and read or
write a document's Y.Doc.

## Install

```sh
npm install @tetsustudio/editor yjs y-prosemirror y-protocols
```

Peer dependencies: `react` and `react-dom` ^19 (the code also runs on React
18), `yjs` ^13.6.31, `y-prosemirror` ^1.3.7, `y-protocols` ^1.0.7, and
optionally `@tetsustudio/tokens` ^0.1.0 for theming. Milkdown (pinned to
7.21.2), CodeMirror 6 and nspell come as dependencies.

Import the CSS once (it already contains ProseMirror's base CSS):

```ts
import '@tetsustudio/editor/styles.css';
```

## Minimal example

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CollaborativeEditor, type EditorSyncStatus } from '@tetsustudio/editor';

export function Note({ id }: { id: string }) {
  const doc = useMemo(() => new Y.Doc(), [id]);
  const provider = useMemo(() => new WebsocketProvider('wss://yjs.example.com', id, doc), [doc, id]);
  const [status, setStatus] = useState<EditorSyncStatus>('connecting');

  useEffect(() => {
    const onSync = (synced: boolean) => setStatus(synced ? 'synced' : 'syncing');
    provider.on('sync', onSync);
    return () => {
      provider.off('sync', onSync);
      provider.destroy();
      doc.destroy();
    };
  }, [provider, doc]);

  return (
    <CollaborativeEditor
      documentId={id}
      doc={doc}
      awareness={provider.awareness}
      status={status}
      initialMarkdown="# Untitled\n"
      onMarkdownChange={(markdown) => console.log(markdown)}
      uploadImage={async (file) => {
        const body = new FormData();
        body.append('file', file);
        const res = await fetch('/api/images', { method: 'POST', body });
        if (!res.ok) throw new Error('Upload failed');
        return { url: (await res.json()).url };
      }}
    />
  );
}
```

Any provider works (y-websocket, y-webrtc, y-indexeddb, your own): pass its
`Y.Doc`, its `Awareness` and a `status`. The editor stays read-only until the
status is `synced` or `offline`; then, if the document is still empty, it
writes `initialMarkdown` and starts editing. Remote cursors use each awareness
user's `user.name` and `user.color`.

Without collaboration:

```tsx
<MarkdownEditor documentId="draft" initialMarkdown={text} onMarkdownChange={setText} />
```

## Components

| Export | What |
| --- | --- |
| `CollaborativeEditor` | Milkdown on a `Y.Doc` (`doc`, `awareness`, `status`), Yjs undo history |
| `MarkdownEditor` | The same editor on `initialMarkdown`, local undo history |
| `PlainTextEditor` | The document as editable markdown (CodeMirror), through the `bridge` from `onReady` |
| `EditorToolbar` | The formatting bar (already inside both editors unless `toolbar={false}`) |
| `SearchBar` | Find in document (shown by the editors with `searchOpen`) |
| `SpellcheckSettings` | Dialog: on/off, auto-accent, language, ignored words |
| `ImageLightbox` | Full-screen image viewer with zoom (images open in it on click) |

### Editor props (both editors)

| Prop | Default | |
| --- | --- | --- |
| `documentId` | `null` | Collapsed headings are remembered per id; a new id remounts the editor |
| `initialMarkdown` | `''` | Collaborative: seeded only into an empty document |
| `onMarkdownChange(markdown)` | | After every change |
| `onReady(api \| null)` | | Once bound and editable; `null` on unmount. `api` is a `DocumentBridge` plus `editor`, `getMarkdown()`, `focus()` |
| `uploadImage` | | See adapters. Without it the image button is hidden |
| `convertEmbeddedImages` | `false` | Upload images embedded as `data:` URIs and replace them (only for users who can write) |
| `onImageUploadError(error)` | | Also shown under the editor for 5 s |
| `readOnly` | `false` | |
| `autoFocus` | `false` | Focus once editable, unless the user is already elsewhere |
| `labels` | English | See labels |
| `storage`, `storagePrefix` | `localStorage`, `tetsu-editor` | See adapters |
| `dictionaryBaseUrl` | `/editor-dictionaries` | See dictionaries |
| `spellcheck` | shared controller | A `SpellcheckController`, or `false` to turn it off |
| `toolbar` | `true` | |
| `onOpenOutline`, `outlineOpen` | | Adds an "Outline" toggle to the toolbar |
| `searchOpen`, `onCloseSearch` | `false` | Shows the find bar above the document |
| `selfScroll` | `false` | Scroll inside the editor's own box (fixed-height panels) |
| `fontFamily`, `fontSize` | tokens | CSS values for the document text |
| `className` | | On the root `.ted-editor` |

`CollaborativeEditor` adds `doc`, `awareness` and `status` (`'connecting' |
'syncing' | 'synced' | 'offline'`).

### Plain-text mode

```tsx
const [api, setApi] = useState<EditorApi | null>(null);

<div hidden={mode === 'plain'}>
  <CollaborativeEditor {...props} onReady={setApi} />
</div>
{mode === 'plain' && api && <PlainTextEditor bridge={api} />}
```

Keep the visual editor mounted (hidden): every plain-text change goes through
it into the Y.Doc as an ordinary edit, as a minimal replacement, so concurrent
edits by others merge instead of being overwritten. Remote changes come back
into the text without rewriting how the user wrote the rest.

## Adapters

**`uploadImage(file) => Promise<{ url, alt? }>`**: every image that enters the
document (picked in the toolbar, pasted, dropped, or embedded as base64 by
pasted HTML when `convertEmbeddedImages`) goes through it, and `url` is what
lands in the markdown. Throw an `Error` to report a failure; its message is
shown.

**`storage: { get(key), set(key, value) }`**: per-device preferences
(spellcheck settings, ignored words, collapsed headings). Never document
content. The default is `localStorageAdapter`; `createMemoryStorage()` is
there for tests and server rendering. Keys start with `storagePrefix`
(`<prefix>-spellcheck-enabled`, `<prefix>-spellcheck-language`,
`<prefix>-spellcheck-auto-accent`, `<prefix>-spellcheck-ignored-<lang>`,
`<prefix>-collapsed-headings:<documentId>`).

**`dictionaryBaseUrl`**: where the spellchecker fetches
`<base>/<es|es-ar|en>/index.aff` and `index.dic`. See dictionaries.

**Spellcheck controller**: editors and `SpellcheckSettings` that get the same
`storage`, `storagePrefix` and `dictionaryBaseUrl` share one controller
(`getSpellcheck(options)`), so a change in the dialog applies at once to every
mounted editor. Build your own with `createSpellcheck({ storage, storagePrefix,
dictionaryBaseUrl, defaultLanguage, loadFile, createChecker })` and pass it as
`spellcheck` to both.

## Labels

Every string is in `labels`; pass a partial set and the rest stays English.
The Spanish (es-AR) set ships as `esLabels`:

```tsx
import { esLabels } from '@tetsustudio/editor';

<CollaborativeEditor {...props} labels={esLabels} />
<SpellcheckSettings open={open} onClose={close} labels={esLabels} />
<CollaborativeEditor {...props} labels={{ ...esLabels, outline: 'Contenido' }} />
```

## Dictionaries

The spellchecker loads Hunspell dictionaries over HTTP from your public
folder. They come with the package (as its dependencies `dictionary-es`,
`dictionary-es-ar` and `dictionary-en`); copy them into the app with the bin,
for example on every install:

```json
{
  "scripts": {
    "postinstall": "tetsu-editor-dictionaries public/editor-dictionaries"
  }
}
```

`tetsu-editor-dictionaries [destDir]` (default `public/editor-dictionaries`)
writes `<destDir>/<lang>/index.aff`, `index.dic` and the dictionary's
`LICENSE`. Serve them from another path or a CDN with `dictionaryBaseUrl`.
Without dictionaries the editor works; it just draws no underlines. On touch
devices the browser's own spellchecker is used instead.

Licenses: the Spanish dictionaries (`es`, `es-ar`, from the RLA-ES project via
[wooorm/dictionaries](https://github.com/wooorm/dictionaries)) are
`GPL-3.0 OR LGPL-3.0 OR MPL-1.1`; the English one (SCOWL) is `MIT AND BSD`.
All allow redistribution; keep the copied `LICENSE` files next to them. The
dictionaries are data loaded at run time, not part of this MIT package's code.

## Server entry

```ts
import * as Y from 'yjs';
import { getMarkdownCodec, docFromUpdates, readDocument, applyMarkdown, replaceText } from '@tetsustudio/editor/server';

const codec = await getMarkdownCodec(); // the editor's schema, no DOM
const ydoc = docFromUpdates(storedUpdates);
const { markdown } = readDocument(ydoc, codec);

const before = Y.encodeStateVector(ydoc);
const { changed } = applyMarkdown(ydoc, codec, (md) => replaceText(md, 'old', 'new'));
if (changed) await saveUpdate(Y.encodeStateAsUpdate(ydoc, before));
```

| Export | What |
| --- | --- |
| `getMarkdownCodec()` / `createMarkdownCodec()` | `{ schema, parse(markdown), serialize(doc) }`, the shared one or a new one |
| `COLLAB_FRAGMENT` | `'prosemirror'`, the `Y.XmlFragment` the editor binds to |
| `docFromUpdates(updates)` | A `Y.Doc` from stored updates |
| `readDocument(ydoc, codec)` | `{ doc, markdown }` |
| `seedIfEmpty(ydoc, codec, markdown)` | Writes markdown into an empty document only |
| `applyMarkdown(ydoc, codec, change)` | Applies a markdown change as a minimal CRDT edit |
| `replaceText(text, search, replacement, all?)` | Throws `InvalidEditError` (`reason`: `empty`, `not_found`, `ambiguous`) |
| `appendMarkdown(text, addition)` | Appends a block after one blank line |
| `configureListSpread(ctx)`, `configureImageAttrs(ctx)` | Milkdown 7.21 schema fixes, for your own Milkdown setups |

## Theming

All classes start with `ted-` and every color reads a token variable with a
neutral fallback: `--background`, `--foreground`, `--surface`, `--border`,
`--muted-foreground`, `--accent`, `--brand`, `--brand-foreground`,
`--destructive`, `--warning`, `--radius`, `--font-sans`, `--font-heading`,
`--font-mono`. With [`@tetsustudio/tokens`](../tokens) loaded it follows the
active style and dark mode. To tune the editor alone, override its own variables on
`.ted-editor` in CSS loaded after the package's (for example `--ted-link`, `--ted-body`, `--ted-spell-underline`
or `--ted-header-height`, the height of a sticky header above the editor so
the caret and the find bar stay below it).

MIT © Tetsu Studio
