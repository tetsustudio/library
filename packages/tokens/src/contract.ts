import { contrastRatio } from './styles.js'

/** Variables every theme must set, in light and in dark. */
export const REQUIRED_THEME_VARIABLES = [
  '--background',
  '--surface',
  '--foreground',
  '--brand',
  '--brand-foreground',
] as const

/** Variables a theme may override; everything else derives from the required five. */
export const OPTIONAL_THEME_VARIABLES = [
  '--radius',
  '--shape-full',
  '--shape-lg',
  '--style-border',
  '--muted-foreground',
  '--border',
  '--input',
  '--primary',
  '--primary-foreground',
  '--destructive',
  '--destructive-foreground',
  '--success',
  '--success-foreground',
  '--warning',
  '--warning-foreground',
  '--info',
  '--info-foreground',
  '--font-sans',
  '--font-heading',
  '--font-mono',
] as const

/** WCAG AA for normal text. */
export const MIN_TEXT_CONTRAST = 4.5
/** WCAG AA for large text and UI parts, used for brand on surface. */
export const MIN_UI_CONTRAST = 3

export type ThemeVariables = Record<string, string>

export interface ParsedTheme {
  light: ThemeVariables
  dark: ThemeVariables
}

export interface ThemeProblem {
  mode: 'light' | 'dark'
  message: string
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function normalizeHex(value: string): string | null {
  const hex = value.trim().toLowerCase()
  if (!HEX.test(hex)) return null
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  return hex
}

function declarations(body: string): ThemeVariables {
  const result: ThemeVariables = {}
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    result[match[1]!] = match[2]!.trim()
  }
  return result
}

/**
 * Reads the light and dark variables of one style from a theme.css. Light is
 * every rule whose selector names `[data-style='<id>']` without `.dark`; dark is
 * every rule that names both.
 */
export function parseThemeCss(css: string, styleId: string): ParsedTheme {
  const light: ThemeVariables = {}
  const dark: ThemeVariables = {}
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.replace(/\s+/g, ' ')
    const names = new RegExp(`data-style=['"]?${styleId}['"]?\\]`).test(selector)
    if (!names) continue
    Object.assign(selector.includes('.dark') ? dark : light, declarations(match[2]!))
  }
  return { light, dark }
}

/** Checks a theme against the contract: required variables and contrast. */
export function validateTheme(theme: ParsedTheme): ThemeProblem[] {
  const problems: ThemeProblem[] = []
  for (const mode of ['light', 'dark'] as const) {
    // Dark inherits whatever the light block set and dark does not override.
    const vars = mode === 'light' ? theme.light : { ...theme.light, ...theme.dark }
    for (const name of REQUIRED_THEME_VARIABLES) {
      if (!vars[name]) problems.push({ mode, message: `missing ${name}` })
    }
    if (mode === 'dark' && Object.keys(theme.dark).length === 0) {
      problems.push({ mode, message: 'no dark block (selector with .dark and the style id)' })
      continue
    }
    const pair = (a: string, b: string, min: number) => {
      const x = vars[a] && normalizeHex(vars[a]!)
      const y = vars[b] && normalizeHex(vars[b]!)
      if (!vars[a] || !vars[b]) return
      if (!x || !y) {
        problems.push({ mode, message: `${a} and ${b} must be hex colors to check contrast` })
        return
      }
      const ratio = contrastRatio(x, y)
      if (ratio < min) {
        problems.push({
          mode,
          message: `${a} on ${b} contrast ${ratio.toFixed(2)} is below ${min}`,
        })
      }
    }
    pair('--foreground', '--background', MIN_TEXT_CONTRAST)
    pair('--foreground', '--surface', MIN_TEXT_CONTRAST)
    pair('--brand-foreground', '--brand', MIN_TEXT_CONTRAST)
    pair('--brand', '--surface', MIN_UI_CONTRAST)
  }
  return problems
}
