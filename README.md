# Tetsu library

Components and tokens for Tetsu Studio apps, documented at
[library.tetsustudio.com](https://library.tetsustudio.com).

| Package | What |
| --- | --- |
| [`@tetsustudio/tokens`](packages/tokens) | CSS variable contract, visual styles, palettes, theme validator |
| [`@tetsustudio/data-grid`](packages/data-grid) | Table and spreadsheet views of one data set, with a store driven by transport/realtime/notify adapters |
| [`@tetsustudio/reader`](packages/reader) | PDF and EPUB reader: OCR, translation, read aloud, progress sync adapters |
| [`@tetsustudio/editor`](packages/editor) | Collaborative markdown editor (Milkdown + Yjs) with plain-text mode, spellcheck and uploadImage/storage/dictionaryBaseUrl/labels adapters; headless `/server` entry |

Basic components (button, dialog, select…) are a shadcn registry at
`https://library.tetsustudio.com/r`, built from `apps/site/registry/ui`; heavy
components ship as npm packages. `apps/site` is library.tetsustudio.com:
the registry, a live showcase and a style picker for every theme.

```sh
npx shadcn@latest add https://library.tetsustudio.com/r/tetsu-theme.json
npx shadcn@latest add https://library.tetsustudio.com/r/button.json
```

## Develop

```sh
npm install
npm run build && npm test
npx changeset   # describe a change to a published package
```

Before merging a PR that changes a published package, run
`npx changeset version` in it. On `main`, the release workflow publishes every
version not yet on npm (trusted publishing) and mirrors it to GitHub Packages.

MIT © Tetsu Studio
