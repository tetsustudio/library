# @tetsustudio/tokens

The Tetsu design-token contract: plain CSS custom properties, the visual styles
(`data-style`), their palettes, and a validator for new themes.

```sh
npm install @tetsustudio/tokens
```

## Use

```css
/* Any app */
@import '@tetsustudio/tokens/css';

/* Tailwind v4 apps, after tailwindcss */
@import 'tailwindcss';
@import '@tetsustudio/tokens/css';
@import '@tetsustudio/tokens/tailwind.css';
```

```html
<html data-style="tetsu" class="dark">
```

Styles: `original`, `recto`, `papel`, `bloque`, `caramelo`, `tetsu`, `vidrio`.
Each one ships a default light and dark palette; `class="dark"` switches mode.

## Gallery themes

Every style of [style.tetsustudio.com](https://style.tetsustudio.com) ships as
a theme: brasa, chicle, hambre, laca, musgo, origami, plano, tetsu, vidrio, and
the app styles original, recto, papel, bloque and caramelo.

```css
@import '@tetsustudio/tokens/css';
@import '@tetsustudio/tokens/themes/vidrio.css';
```

```html
<html data-style="vidrio">  <!-- class="dark" for dark mode -->
```

A theme loads its Google Fonts and sets colors (light and dark), shape and
fonts. Its rules are unlayered, so they win over the base palettes. The list is
exported as `GALLERY_THEMES`; `npm run sync-themes` refreshes it from the
gallery repo.

## The contract

A theme sets five variables, in light and in dark:

| Variable | Role |
| --- | --- |
| `--background` | Page ground |
| `--surface` | Raised areas: inputs, popovers, muted blocks |
| `--foreground` | Text |
| `--brand` | Accent, focus ring, primary button in most styles |
| `--brand-foreground` | Text on `--brand` |

Everything else (`--border`, `--muted-foreground`, `--primary`, the shadcn
variables, sidebar and chart colors) derives from them with `color-mix()`. A
theme may also override shape (`--radius`, `--shape-full`, `--shape-lg`,
`--style-border`), type (`--font-sans`, `--font-heading`, `--font-mono`) and
status colors (`--destructive`, `--success`, `--warning`, `--info` and their
`-foreground`).

Fonts are not bundled: load them in the app and set `--font-inter`,
`--font-nunito`, `--font-jetbrains`, `--font-newsreader`, `--font-archivo`,
`--font-archivo-black` or `--font-fredoka` as needed; without them each style
falls back to a system stack.

## Validate a theme

```sh
npx tetsu-validate-theme theme.css my-style
```

Fails when a required variable is missing (light or dark) or when contrast is
below AA: text on background and surface 4.5, text on brand 4.5, brand on
surface 3. The same checks are exported as `parseThemeCss` and `validateTheme`.

## JavaScript

```ts
import { STYLE_IDS, VISUAL_STYLES, COLOR_THEME_PRESETS, applyPalette } from '@tetsustudio/tokens'
```

MIT © Tetsu Studio
