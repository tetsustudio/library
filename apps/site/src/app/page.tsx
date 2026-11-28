import { ThemePicker } from '@/components/theme-picker'
import { Showcase } from '@/components/showcase'
import { CopyCommand } from '@/components/copy-command'
import { ALL_STYLES } from '@/lib/styles'

const PACKAGES = [
  {
    name: '@tetsustudio/tokens',
    what: 'The CSS variable contract, 14 styles with light and dark palettes, Tailwind v4 mapping and a theme validator.',
  },
  {
    name: '@tetsustudio/data-grid',
    what: 'Tables with a table and a spreadsheet mode (Glide), optimistic edits, realtime and presence through adapters.',
  },
  {
    name: '@tetsustudio/reader',
    what: 'PDF and EPUB reader with progress, translation and OCR through adapters; assets served by your app.',
  },
  {
    name: '@tetsustudio/editor',
    what: 'Collaborative Markdown editor on Milkdown and Yjs, with image upload, spellcheck and a headless server entry.',
  },
]

export default function Home() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-16 px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="font-heading text-xl font-semibold">
          Tetsu library
        </a>
        <ThemePicker />
      </header>

      <section className="flex max-w-3xl flex-col gap-5">
        <h1 className="font-heading text-4xl font-semibold tracking-tight md:text-5xl">
          Components and tokens for every Tetsu app.
        </h1>
        <p className="text-lg text-muted-foreground">
          Basic components install as source through a shadcn registry. Heavy pieces (tables, reader,
          editor) ship as npm packages and update with Dependabot. Everything reads the same CSS variables,
          so a style from{' '}
          <a className="underline underline-offset-4" href="https://style.tetsustudio.com">
            style.tetsustudio.com
          </a>{' '}
          themes all of it. Pick one of the {ALL_STYLES.length} styles above.
        </p>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="font-heading text-2xl font-semibold">Start</h2>
        <ol className="flex flex-col gap-4">
          <li className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">1. Add the theme (Tailwind v4 app with shadcn set up)</span>
            <CopyCommand command="npx shadcn@latest add https://library.tetsustudio.com/r/tetsu-theme.json" />
          </li>
          <li className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">2. Pick a style on the html element</span>
            <CopyCommand command={'<html data-style="tetsu" class="dark">'} />
          </li>
          <li className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">3. Add components, or a gallery theme</span>
            <CopyCommand command="npx shadcn@latest add https://library.tetsustudio.com/r/button.json" />
            <CopyCommand command="@import '@tetsustudio/tokens/themes/vidrio.css';" />
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="font-heading text-2xl font-semibold">Packages</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {PACKAGES.map((p) => (
            <article key={p.name} className="flex flex-col gap-3 rounded-lg border border-border p-5">
              <a
                href={`https://www.npmjs.com/package/${p.name}`}
                className="font-mono text-sm font-medium underline-offset-4 hover:underline"
              >
                {p.name}
              </a>
              <p className="text-sm text-muted-foreground">{p.what}</p>
              <CopyCommand command={`npm install ${p.name}`} />
            </article>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="font-heading text-2xl font-semibold">Components</h2>
        <Showcase />
      </section>

      <footer className="border-t border-border pt-6 text-sm text-muted-foreground">
        MIT · <a href="https://github.com/tetsustudio/library">github.com/tetsustudio/library</a> · registry at{' '}
        <a href="/r/registry.json">/r/registry.json</a>
      </footer>
    </div>
  )
}
