import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  COLOR_THEME_PRESETS,
  GALLERY_THEMES,
  REQUIRED_THEME_VARIABLES,
  STYLE_IDS,
  VISUAL_STYLES,
  contrastRatio,
  parseThemeCss,
  readableOn,
  validateTheme,
} from '../dist/index.js'

test('every palette meets AA contrast', () => {
  for (const p of COLOR_THEME_PRESETS) {
    assert.ok(contrastRatio(p.foreground, p.background) >= 4.5, `${p.style}/${p.id} fg on bg`)
    assert.ok(contrastRatio(p.foreground, p.surface) >= 4.5, `${p.style}/${p.id} fg on surface`)
    assert.ok(contrastRatio(p.accent, p.surface) >= 3, `${p.style}/${p.id} accent on surface`)
    assert.ok(contrastRatio(readableOn(p.accent), p.accent) >= 4.5, `${p.style}/${p.id} text on accent`)
  }
})

test('every style has a light and dark default palette', () => {
  for (const id of STYLE_IDS) {
    const { defaultFamily } = VISUAL_STYLES[id]
    for (const mode of ['light', 'dark']) {
      assert.ok(
        COLOR_THEME_PRESETS.some((p) => p.style === id && p.id === `${defaultFamily}-${mode}`),
        `${id} ${mode}`,
      )
    }
  }
})

test('generated palettes.css passes the contract for every style', () => {
  const css = readFileSync('dist/css/palettes.css', 'utf8')
  for (const id of STYLE_IDS) {
    assert.deepEqual(validateTheme(parseThemeCss(css, id)), [], id)
  }
})

test('validator reports missing variables and low contrast', () => {
  const css = `
    html[data-style='x'] { --background: #ffffff; --surface: #ffffff; --foreground: #777777; --brand: #ffffff; }
    html[data-style='x'].dark { --background: #000000; }
  `
  const problems = validateTheme(parseThemeCss(css, 'x')).map((p) => `${p.mode}: ${p.message}`)
  assert.ok(problems.includes('light: missing --brand-foreground'))
  assert.ok(problems.some((m) => m.startsWith('light: --foreground on --background contrast')))
  assert.ok(problems.some((m) => m.startsWith('light: --brand on --surface contrast')))
})

test('validator requires a dark block', () => {
  const css = `html[data-style='y'] { --background:#fff; --surface:#fff; --foreground:#000; --brand:#1d4ed8; --brand-foreground:#fff; }`
  const problems = validateTheme(parseThemeCss(css, 'y'))
  assert.deepEqual(problems.map((p) => p.mode), ['dark'])
})

test('required variables are the five base tones', () => {
  assert.deepEqual([...REQUIRED_THEME_VARIABLES], [
    '--background', '--surface', '--foreground', '--brand', '--brand-foreground',
  ])
})

test('package exports point at built files', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  for (const [key, target] of Object.entries(pkg.exports)) {
    const file = (typeof target === 'string' ? target : target.import).replace('*', 'tetsu.css')
    assert.ok(existsSync(file), `${key} -> ${file}`)
  }
})

test('every gallery theme passes the contract', () => {
  assert.ok(GALLERY_THEMES.length >= 14)
  for (const id of GALLERY_THEMES) {
    const css = readFileSync(`dist/themes/${id}.css`, 'utf8')
    assert.deepEqual(validateTheme(parseThemeCss(css, id)), [], id)
  }
})
