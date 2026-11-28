// Serves the gallery themes at /themes/<id>.css so the style picker can swap them.
import { cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkg = dirname(require.resolve('@tetsustudio/tokens/package.json'))
mkdirSync('public/themes', { recursive: true })
cpSync(join(pkg, 'dist/themes'), 'public/themes', { recursive: true })
