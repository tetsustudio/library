# Tetsu library

Components and tokens for Tetsu Studio apps, documented at
[library.tetsustudio.com](https://library.tetsustudio.com).

| Package | What |
| --- | --- |
| [`@tetsustudio/tokens`](packages/tokens) | CSS variable contract, visual styles, palettes, theme validator |

Basic components (button, dialog, select…) are a shadcn registry at
`https://library.tetsustudio.com/r`; heavy components ship as npm packages.

## Develop

```sh
npm install
npm run build && npm test
npx changeset   # describe a change to a published package
```

Releases run from `main`: Changesets opens a "Version packages" PR, and merging
it publishes to npm with trusted publishing and mirrors to GitHub Packages.

MIT © Tetsu Studio
