// Builds dist/styles.css: compiles the components' Tailwind classes with the
// Tailwind v4 CLI (no preflight, theme values inlined, colors from the token
// variables), then scopes every rule under `.trd-root` so the stylesheet only
// styles the reader. Apps need no Tailwind, and their own utilities with the
// same names never pick up these values.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const cliPkg = require.resolve('@tailwindcss/cli/package.json')
const cli = join(dirname(cliPkg), JSON.parse(readFileSync(cliPkg, 'utf8')).bin.tailwindcss)

const work = mkdtempSync(join(tmpdir(), 'tetsu-reader-css-'))
try {
  const raw = join(work, 'raw.css')
  execFileSync(process.execPath, [cli, '-i', join(root, 'src/styles.css'), '-o', raw, '--minify'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const css = readFileSync(raw, 'utf8')
  const scoped = postcss([scopeTo('.trd-root')]).process(css, { from: undefined }).css
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist/styles.css'), scoped)
  console.log(`dist/styles.css (${Math.round(scoped.length / 1024)} KB)`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

/** Prefixes top-level selectors with `:where(<scope>)` (no specificity added). */
function scopeTo(scope) {
  return {
    postcssPlugin: 'scope-to',
    Rule(rule) {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
      // @property fallbacks for old Safari/Firefox: global `--tw-*` defaults, harmless.
      if (inside(rule, (node) => node.type === 'atrule' && node.name === 'layer' && node.params === 'properties')) return
      rule.selectors = rule.selectors.map((selector) => {
        if (selector.startsWith(scope) || selector.startsWith(`:where(${scope})`)) return selector
        return `:where(${scope}) ${selector}`
      })
    },
  }
}

function inside(node, test) {
  for (let parent = node.parent; parent; parent = parent.parent) if (test(parent)) return true
  return false
}
