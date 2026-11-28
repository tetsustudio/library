// Writes registry.json (the shadcn registry manifest) from registry/ui/*.tsx:
// npm dependencies and sibling items come from each file's imports, so the
// manifest never drifts from the code. `shadcn build` then emits public/r/*.json.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const BASE = 'https://library.tetsustudio.com/r'
const VERSIONS = {
  '@ui-sdk/react': '@ui-sdk/react@0.1.0-beta.5',
  'class-variance-authority': 'class-variance-authority@^0.7.1',
  cn: 'cn@^0.4.0',
  'lucide-react': 'lucide-react@^1.16.0',
}
const TITLES = { 'dropdown-menu': 'Dropdown menu', 'input-group': 'Input group' }

// Stacking and motion of the toast region (ui-sdk sets the --toast-* variables).
const TOAST_CSS = {
  "[data-slot='toast-region']": {
    position: 'fixed', top: '1rem', left: '50%', 'z-index': '100',
    width: 'min(356px, calc(100vw - 2rem))', height: 'var(--toast-front-height)', translate: '-50% 0',
  },
  "[data-slot='toast-region'][data-expanded]": {
    height: 'calc(var(--toast-stack-height) + (var(--toast-count) - 1) * 12px)',
  },
  "[data-slot='toast']": {
    '--y': 'calc(var(--toast-index) * 12px)', position: 'absolute', 'inset-inline': '0', top: '0',
    'z-index': 'calc(100 - var(--toast-index))', overflow: 'hidden', height: 'var(--toast-height)',
    translate: 'var(--toast-swipe-x, 0px) calc(var(--y) + var(--toast-swipe-y, 0px))',
    scale: 'calc(1 - var(--toast-index) * 0.05)', 'transition-property': 'translate, scale, opacity, height',
    'transition-duration': '400ms', 'user-select': 'none',
  },
  "[data-slot='toast']:not([data-front], [data-expanded])": { height: 'var(--toast-front-height)' },
  "[data-slot='toast'][data-expanded]": { '--y': 'calc(var(--toast-offset) + var(--toast-index) * 12px)', scale: '1' },
  "[data-slot='toast'][data-starting-style], [data-slot='toast'][data-swiping]": { transition: 'none' },
  "[data-slot='toast'][data-starting-style][data-front]": { '--y': '-100%' },
  "[data-slot='toast']:is([data-starting-style]:not([data-front]), [data-ending-style])": { opacity: '0' },
  '@media (prefers-reduced-motion: reduce)': { "[data-slot='toast']": { 'transition-property': 'opacity' } },
}

const files = readdirSync('registry/ui').filter(f => f.endsWith('.tsx')).sort()
const items = files.map(file => {
  const name = file.replace(/\.tsx$/, '')
  const src = readFileSync(`registry/ui/${file}`, 'utf8')
  const imports = [...src.matchAll(/from '([^']+)'/g)].map(m => m[1])
  const deps = new Set()
  const siblings = new Set()
  for (const spec of imports) {
    if (spec === 'react') continue
    const sibling = spec.match(/^@\/components\/ui\/(.+)$/)
    if (sibling) { siblings.add(`${BASE}/${sibling[1]}.json`); continue }
    const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    if (!VERSIONS[pkg]) throw new Error(`${file}: no pinned version for ${pkg}`)
    deps.add(VERSIONS[pkg])
  }
  return {
    name,
    type: 'registry:ui',
    title: TITLES[name] ?? name[0].toUpperCase() + name.slice(1),
    description: `Tetsu ${name} on @ui-sdk/react, styled with the @tetsustudio/tokens variables.`,
    dependencies: [...deps].sort(),
    ...(siblings.size ? { registryDependencies: [...siblings].sort() } : {}),
    files: [{ path: `registry/ui/${file}`, type: 'registry:ui' }],
    ...(name === 'toast' ? { css: { '@layer components': TOAST_CSS } } : {}),
  }
})

items.push({
  name: 'tetsu-theme',
  type: 'registry:style',
  title: 'Tetsu theme',
  description: 'Installs @tetsustudio/tokens and wires its CSS variables into Tailwind v4. Pick a style with <html data-style="...">.',
  dependencies: ['@tetsustudio/tokens', 'tw-animate-css'],
  registryDependencies: [],
  css: {
    "@import '@tetsustudio/tokens/css'": {},
    "@import '@tetsustudio/tokens/tailwind.css'": {},
    "@import 'tw-animate-css'": {},
  },
  files: [],
})

writeFileSync('registry.json', JSON.stringify({
  $schema: 'https://ui.shadcn.com/schema/registry.json',
  name: 'tetsu',
  homepage: 'https://library.tetsustudio.com',
  items,
}, null, 2) + '\n')
console.log(`registry.json: ${items.length} items`)
