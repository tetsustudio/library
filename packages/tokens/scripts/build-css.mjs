// Copies the hand-written CSS into dist/css and generates palettes.css and
// index.css from the compiled styles, so the TS presets stay the one source.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { COLOR_THEME_PRESETS, VISUAL_STYLES, palettesCss } from '../dist/index.js'

mkdirSync('dist/css', { recursive: true })
cpSync('src/css', 'dist/css', { recursive: true })
const defaults = Object.fromEntries(
  Object.entries(VISUAL_STYLES).map(([id, style]) => [id, style.defaultFamily]),
)
writeFileSync('dist/css/palettes.css', palettesCss(COLOR_THEME_PRESETS, defaults))
writeFileSync(
  'dist/css/index.css',
  "@import './base.css';\n@import './styles.css';\n@import './palettes.css';\n",
)
