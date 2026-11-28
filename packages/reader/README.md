# @tetsustudio/reader

A book reader for React 19: PDF (page view, adjustable text view with figures
and tables, OCR view for scanned books) and EPUB (continuous scroll, search,
read aloud, image viewer). Live translation, reading themes, fonts and margins,
and a position engine that syncs through your backend and resolves conflicts
between devices. Ported from glimpse; no Next.js, no Tailwind needed.

## Install

```sh
npm i @tetsustudio/reader @tetsustudio/tokens pdfjs-dist@6.2.108 epubjs@0.3.93
# Optional: OCR for scanned PDFs, and its language data
npm i tesseract.js@7.0.0 @tesseract.js-data/eng @tesseract.js-data/spa
# Optional: the IndexedDB storage adapter
npm i idb
```

Copy the runtime assets (pdf.js worker, cmaps, fonts, wasm; tesseract worker,
core and language data) into your public directory, from `postinstall` so they
follow upgrades:

```json
{ "scripts": { "postinstall": "tetsu-reader-assets public/reader-assets --lang eng,spa" } }
```

`tetsu-reader-assets [destDir] [--lang eng,spa]` defaults to
`public/reader-assets` and `eng,spa`. A language whose `@tesseract.js-data/<lang>`
package is missing is reported and skipped; without `tesseract.js` the OCR files
are skipped. Add the destination to `.gitignore`.

Import the styles once (they read the `@tetsustudio/tokens` variables):

```ts
import '@tetsustudio/tokens/css'
import '@tetsustudio/reader/styles.css'
```

## Use

```tsx
'use client'
import { Reader } from '@tetsustudio/reader'
import { createIdbStorage } from '@tetsustudio/reader/idb-storage'

const storage = createIdbStorage()

export function BookPage({ book, progress }) {
  return (
    <div style={{ height: '100dvh' }}>
      <Reader
        src={`/api/books/${book.id}/file`}
        format={book.isPdf ? 'pdf' : 'epub'}
        bookId={book.id}
        title={book.title}
        initialProgress={progress && { locator: progress.cfi, percent: progress.percentage, updatedAt: progress.updated_at, deviceId: progress.device_id }}
        onProgress={async ({ bookId, locator, percent, deviceId, reason }) => {
          const res = await fetch('/api/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookId, cfi: locator, percent, deviceId }),
            keepalive: reason === 'hidden',
          })
          if (!res.ok) throw new Error(`progress ${res.status}`)
          const saved = await res.json()
          return { updatedAt: saved.updated_at }
        }}
        translate={async (text, target, source) => {
          const res = await fetch('/api/translate', { method: 'POST', body: JSON.stringify({ text, source, target }) })
          return (await res.json()).translatedText
        }}
        onExit={() => router.push('/library')}
        language="es"
        storage={storage}
      />
    </div>
  )
}
```

`Reader` picks `PdfReader` or `EpubReader` by `format`, or by the extension of
`src` (`.pdf` is PDF, anything else EPUB). Both are exported too. The reader
fills its parent: give the parent a height.

## Props

| Prop | Type | |
| --- | --- | --- |
| `src` | `string` | URL of the file. |
| `bookId` | `string` | Keys the progress cache, the offline file and the OCR cache. |
| `title` | `string` | Shown in the header. |
| `format` | `'pdf' \| 'epub'` | `Reader` only. Overrides detection by extension. |
| `initialProgress` | `{ locator, percent, updatedAt?, deviceId? } \| null` | The last stored position. `null`: none stored. Leave it out without a backend. |
| `onProgress` | `(event) => Promise<{ updatedAt? } \| void>` | Persists the position. See below. |
| `translate` | `(text, targetLang, sourceLang) => Promise<string>` | Without it the translate feature is hidden. |
| `onExit` | `() => void` | The back button. Without it the button is hidden. |
| `mode` | `'light' \| 'dark'` | Chrome mode (`dark` adds the tokens' `.dark` class) and default reading theme. Without it the reader follows the app's tokens. |
| `assetBaseUrl` | `string` | Where `tetsu-reader-assets` copied the files. Default `/reader-assets`. |
| `labels` | `Partial<ReaderLabels>` | UI strings. Missing keys fall back to English (`DEFAULT_LABELS`). `{name}` placeholders are kept. |
| `language` | `string` | UI language (`es`, `en`): read-aloud voice order and the default OCR language. Default `en`. |
| `ocrLanguage` | `string` | Tesseract code(s), e.g. `spa` or `spa+eng`. Default `spa` for `es`, else `eng`. |
| `storage` | `ReaderStorage` | Offline cache (book files, OCR results). |
| `speechVoice` | `{ name, lang, synthesize(text, 'mp3' \| 'wav') }` | A remote read-aloud voice next to the browser ones (EPUB). |
| `googleFonts` | `boolean` | Load the font picker's extra fonts from Google Fonts. Default `true`. |
| `storagePrefix` | `string` | Prefix of the localStorage keys. Default `tetsu-reader`. |

### Progress

A position is `{ locator, percent }`: an EPUB CFI or `page:N` for PDF, and 0–100.

- `onProgress` receives `{ bookId, locator, percent, deviceId, reason }`, every
  15 s while there are changes (`interval`), from the back button (`exit`),
  when the tab is hidden or the reader unmounts (`hidden`, not awaited: use
  `keepalive` or `sendBeacon`), and after a conflict is resolved (`conflict`).
- Return the server timestamp of the write (`{ updatedAt }`). The reader never
  compares client clocks: it compares that timestamp with
  `initialProgress.updatedAt`.
- Throw when the write fails: the position stays pending, is retried, and is
  kept in localStorage so the next open pushes it.
- When `initialProgress` comes from another device (`deviceId`), is newer, and
  this device has unsent changes more than 5% away, the reader asks which one
  to keep.
- Without `onProgress` the reader is local: localStorage is the store.

### Storage

```ts
interface ReaderStorage {
  getFile(bookId: string): Promise<Blob | null>   // offline copy, opened instead of src
  getText?(key: string): Promise<string | null>   // OCR cache
  setText?(key: string, value: string): Promise<void>
}
```

`createIdbStorage({ dbName? })` from `@tetsustudio/reader/idb-storage` is an
IndexedDB implementation (`idb` is an optional peer, so the main entry never
imports it). It adds `putFile`, `deleteFile` and `listFiles` for the app's own
"save offline" action.

### Translation

Browsers with the on-device `Translator` API (desktop Chrome and Edge) translate
locally; others call `translate`. Throw `TranslateUnconfiguredError` from it to
show "not configured" instead of "failed". PDFs translate in the text and OCR
views only.

## Content Security Policy

Everything loads from your own origin; nothing comes from a CDN. The app's CSP
must allow:

| Directive | Value | Why |
| --- | --- | --- |
| `worker-src` | `'self' blob:` | pdf.js and tesseract workers. |
| `script-src` | `'self' 'wasm-unsafe-eval'` | pdf.js image decoders and the tesseract core are WebAssembly. If your server also sends the CSP on the worker files, the same applies there. |
| `connect-src` | `'self'` plus the origin of every book URL | pdf.js and epubjs fetch the file; tesseract fetches its language data from `assetBaseUrl`. Add whatever `onProgress`, `translate` and `speechVoice` call. |
| `img-src` | `'self' blob: data:` | PDF figures are cropped to blob URLs; EPUB images. |
| `frame-src` | `'self' blob:` | epubjs renders each section in an iframe. |
| `style-src` | `'self' 'unsafe-inline'` | Reading themes are injected as `<style>` and inline styles. |
| `style-src` / `font-src` | `https://fonts.googleapis.com` / `https://fonts.gstatic.com` | Only with `googleFonts` (default). Pass `googleFonts={false}` to drop them. |
| `media-src` | `blob:` | Only with `speechVoice`. |

**OCR and the CDN.** tesseract.js loads its worker, wasm core and language data
from `cdn.jsdelivr.net` unless told otherwise. The reader always passes
`workerPath`, `corePath` and `langPath` under `assetBaseUrl` (and
`workerBlobURL: false`), so OCR works under a `'self'` CSP and offline once
cached. Make sure `tetsu-reader-assets` ran with the languages you set in
`ocrLanguage`.

EPUB content runs in same-origin iframes with scripts disabled
(`allowScriptedContent: false`): an uploaded book cannot run code in your origin.

## Styling

The components keep glimpse's Tailwind classes. At build time they are compiled
with Tailwind v4 (no preflight, theme values inlined) into `dist/styles.css`,
and every rule is scoped to `:where(.trd-root)`, outside any cascade layer. So
the app needs no Tailwind, the reader's utilities never touch the app's
elements, and inside the reader they beat the app's layered utilities (Tailwind
v4) with the same names. Colors, radius and fonts
come from the token variables (`--background`, `--foreground`, `--surface`,
`--border`, `--brand`, `--muted-foreground`, `--radius`, `--font-sans`…); the
accent (progress bar, selection) is `--brand`. The reading area has its own
themes (light, dark, e-ink, custom) chosen by the reader.

## Notes

- Client only: the component modules are `'use client'`, and pdf.js, epubjs and
  tesseract.js are loaded with dynamic `import()` when a book opens.
- The reader requests fullscreen and, on Android, locks portrait while open, as
  glimpse did. It also sets `<meta name="theme-color">` and, for EPUB, the page
  background to match the reading theme.
- localStorage keys: `<prefix>-settings`, `<prefix>-device-id`,
  `<prefix>:progress:<bookId>`, `<prefix>:viewmode:<bookId>`, plus
  `tetsu-reader-tts-voice` and `tetsu-reader-tts-rate`.

MIT © Tetsu Studio
