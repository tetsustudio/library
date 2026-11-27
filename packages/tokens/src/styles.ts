// Visual styles. A style sets shape and type (its CSS lives in css/styles.css);
// a palette sets four tones (background, surface, foreground, accent). Apps pick
// a style with <html data-style="<id>"> and a palette with the generated
// css/palettes.css or applyPalette(). test/contrast.test.ts checks every palette.
export interface LocalizedText {
  es: string
  en: string
}

export type ThemeMode = 'light' | 'dark'

export const STYLE_IDS = [
  'original',
  'recto',
  'papel',
  'bloque',
  'caramelo',
  'tetsu',
  'vidrio',
] as const
export type StyleId = (typeof STYLE_IDS)[number]

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === 'string' && (STYLE_IDS as readonly string[]).includes(value)
}

// localStorage key of the style the user picked; without one, the app's default.
export const STYLE_STORAGE_KEY = 'visual-style'

export interface VisualStyle {
  label: LocalizedText
  description: LocalizedText
  defaultFamily: string
  defaultMode: ThemeMode
  // In Original the accent is sparse and the primary button stays inverted;
  // in the others the accent paints the primary button.
  accentIsPrimary: boolean
  // Google Fonts ids the style needs, loaded with a <link> at runtime.
  // Its block in css/styles.css names them.
  googleFonts?: readonly string[]
  // How a picker card draws the style's name: heading font and corner radius.
  sample: { font: string; radius: string }
}

export const VISUAL_STYLES: Record<StyleId, VisualStyle> = {
  original: {
    label: { es: 'Original', en: 'Original' },
    description: {
      es: 'Píldoras, sin tarjetas y botón principal invertido.',
      en: 'Pills, no cards and an inverted primary button.',
    },
    defaultFamily: 'mono',
    defaultMode: 'dark',
    accentIsPrimary: false,
    sample: { font: 'var(--font-nunito)', radius: '9999px' },
  },
  recto: {
    label: { es: 'Recto', en: 'Straight' },
    description: {
      es: 'Esquinas rectas, línea fina y más densidad.',
      en: 'Square corners, thin lines and more density.',
    },
    defaultFamily: 'graphite',
    defaultMode: 'dark',
    accentIsPrimary: true,
    sample: { font: 'var(--font-inter)', radius: '0px' },
  },
  papel: {
    label: { es: 'Papel', en: 'Paper' },
    description: {
      es: 'Editorial, con serif y casi sin radios.',
      en: 'Editorial, with serif type and barely any radius.',
    },
    defaultFamily: 'ink',
    defaultMode: 'light',
    accentIsPrimary: true,
    sample: { font: 'var(--font-newsreader)', radius: '3px' },
  },
  bloque: {
    label: { es: 'Bloque', en: 'Block' },
    description: {
      es: 'Bordes gruesos, sombras duras y color fuerte.',
      en: 'Thick borders, hard shadows and strong color.',
    },
    defaultFamily: 'lemon',
    defaultMode: 'light',
    accentIsPrimary: true,
    sample: { font: 'var(--font-archivo-black)', radius: '0px' },
  },
  caramelo: {
    label: { es: 'Caramelo', en: 'Candy' },
    description: {
      es: 'Formas redondas y superficies tintadas.',
      en: 'Round shapes and tinted surfaces.',
    },
    defaultFamily: 'grape',
    defaultMode: 'light',
    accentIsPrimary: true,
    sample: { font: 'var(--font-fredoka)', radius: '20px' },
  },
  // From style.tetsustudio.com/s/tetsu/tokens.json: ember on near-black, the
  // primary button stays inverted (ember marks heat and state, not buttons).
  tetsu: {
    label: { es: 'Tetsu', en: 'Tetsu' },
    description: {
      es: 'Casi negro con brasa, Inter apretada y botón principal invertido.',
      en: 'Near-black with ember, tight Inter and an inverted primary button.',
    },
    defaultFamily: 'brasa',
    defaultMode: 'dark',
    accentIsPrimary: false,
    sample: { font: 'var(--font-inter)', radius: '4px' },
  },
  // From style.tetsustudio.com/s/vidrio/tokens.json.
  vidrio: {
    label: { es: 'Vidrio', en: 'Glass' },
    description: {
      es: 'Claro y técnico: Funnel, un solo cobalto y radios chicos.',
      en: 'Light and technical: Funnel type, a single cobalt and small radii.',
    },
    defaultFamily: 'cobalto',
    defaultMode: 'light',
    accentIsPrimary: true,
    sample: { font: "'Funnel Display', var(--font-inter)", radius: '6px' },
    googleFonts: ['funnel-sans', 'funnel-display', 'martian-mono'],
  },
}

export interface ColorTheme {
  id: string
  style: StyleId
  label: LocalizedText
  mode: ThemeMode
  background: string
  surface: string
  foreground: string
  accent: string
  // Share of foreground in secondary text, when the style's default misses AA.
  mutedMix?: number
}

type Tones = readonly [
  background: string,
  surface: string,
  foreground: string,
  accent: string,
  mutedMix?: number,
]

function palette(
  style: StyleId,
  family: string,
  label: LocalizedText,
  light: Tones,
  dark: Tones,
): ColorTheme[] {
  return (['light', 'dark'] as const).map((mode) => {
    const [background, surface, foreground, accent, mutedMix] = mode === 'light' ? light : dark
    return {
      id: `${family}-${mode}`,
      style,
      label,
      mode,
      background,
      surface,
      foreground,
      accent,
      ...(mutedMix ? { mutedMix } : {}),
    }
  })
}

// prettier-ignore
export const COLOR_THEME_PRESETS: ColorTheme[] = [
  ...palette('original', 'mono', { es: 'Monocromo', en: 'Monochrome' },
    ['#ffffff', '#fafafa', '#000000', '#3b82f6'], ['#090909', '#171717', '#ffffff', '#3b82f6']),
  ...palette('original', 'midnight', { es: 'Medianoche', en: 'Midnight' },
    ['#fffffe', '#f2f4f6', '#00214d', '#1d5fd6', 65], ['#001534', '#00214d', '#fffffe', '#6ab0ff']),

  ...palette('recto', 'graphite', { es: 'Grafito', en: 'Graphite' },
    ['#ffffff', '#f4f4f5', '#0a0a0a', '#0a0a0a'], ['#0a0a0a', '#171717', '#fafafa', '#fafafa']),
  ...palette('recto', 'blue', { es: 'Azul', en: 'Blue' },
    ['#ffffff', '#f4f4f5', '#0a0a0a', '#1d4ed8'], ['#0a0a0a', '#171717', '#fafafa', '#60a5fa']),
  ...palette('recto', 'red', { es: 'Rojo', en: 'Red' },
    ['#ffffff', '#f4f4f5', '#0a0a0a', '#c81e1e'], ['#0a0a0a', '#171717', '#fafafa', '#f87171']),

  ...palette('papel', 'ink', { es: 'Tinta', en: 'Ink' },
    ['#eef0ea', '#f9faf6', '#14213a', '#2740b0'], ['#10182a', '#1a2439', '#e9edf2', '#8ea6ff']),
  ...palette('papel', 'olive', { es: 'Oliva', en: 'Olive' },
    ['#eeecdd', '#f8f7ee', '#23261a', '#56672a'], ['#181a12', '#23261a', '#ecebd9', '#b5c46a']),
  ...palette('papel', 'wine', { es: 'Vino', en: 'Wine' },
    ['#f3ecec', '#fbf7f6', '#2a1216', '#8a1c32'], ['#1c0f12', '#2a181c', '#f5e7e8', '#f0909f']),

  ...palette('bloque', 'lemon', { es: 'Limón', en: 'Lemon' },
    ['#ffe34d', '#fffdf0', '#111111', '#d81b63'], ['#141414', '#232323', '#f6f5ee', '#d9ff3f']),
  ...palette('bloque', 'mint', { es: 'Menta', en: 'Mint' },
    ['#b4f0cf', '#f6fff9', '#0d1f17', '#5b2be0'], ['#0d1f17', '#173026', '#effbf4', '#7dffb8']),
  ...palette('bloque', 'salmon', { es: 'Salmón', en: 'Salmon' },
    ['#ffb39b', '#fff6f2', '#1c0f0b', '#1c3fe0'], ['#1c0f0b', '#2e1b15', '#fff1ea', '#ff9470']),

  ...palette('caramelo', 'grape', { es: 'Uva', en: 'Grape' },
    ['#f5efff', '#ffffff', '#2a1a4a', '#7235e0'], ['#1a1230', '#271c44', '#f1eaff', '#b999ff']),
  ...palette('caramelo', 'peach', { es: 'Durazno', en: 'Peach' },
    ['#fff0e6', '#ffffff', '#43210f', '#c2410c'], ['#241208', '#351d10', '#ffeadc', '#ff9a66']),
  ...palette('caramelo', 'lagoon', { es: 'Laguna', en: 'Lagoon' },
    ['#e6f7f4', '#ffffff', '#0e3638', '#0b7f76'], ['#0a2526', '#123537', '#dcf7f3', '#4fd6c8']),

  ...palette('tetsu', 'brasa', { es: 'Brasa', en: 'Ember' },
    ['#ffffff', '#f4f4f2', '#0b0b0c', '#e2470f'], ['#070708', '#0e0f11', '#f2f2ee', '#ff5a1f']),
  ...palette('tetsu', 'acero', { es: 'Acero', en: 'Steel' },
    ['#ffffff', '#f4f4f2', '#0b0b0c', '#5e6167'], ['#070708', '#0e0f11', '#f2f2ee', '#9aa3ae']),

  ...palette('vidrio', 'cobalto', { es: 'Cobalto', en: 'Cobalt' },
    ['#f3f4f1', '#ffffff', '#16191d', '#1747ff'], ['#0e1013', '#15181c', '#eceeef', '#6e8bff']),
  ...palette('vidrio', 'grafito', { es: 'Grafito', en: 'Graphite' },
    ['#f3f4f1', '#ffffff', '#16191d', '#16191d'], ['#0e1013', '#15181c', '#eceeef', '#eceeef']),
]

export function stylePalettes(style: StyleId): ColorTheme[] {
  return COLOR_THEME_PRESETS.filter((preset) => preset.style === style)
}

// A saved palette wins over the style. A palette that no longer exists, or that
// belongs to another style, falls back to the style's default with the saved mode.
export function resolveColorTheme(
  style: StyleId,
  savedThemeId: string | null,
  savedMode: string | null,
): ColorTheme {
  const palettes = stylePalettes(style)
  const saved = palettes.find((preset) => preset.id === savedThemeId)
  if (saved) return saved
  const { defaultFamily, defaultMode } = VISUAL_STYLES[style]
  const mode = savedMode === 'light' || savedMode === 'dark' ? savedMode : defaultMode
  return palettes.find((preset) => preset.id === `${defaultFamily}-${mode}`)!
}

// An exported theme always carries the current accent. When it is the
// palette's own, the user did not pick it and it must follow the palette.
export function isManualAccent(style: StyleId, themeId: string, mode: ThemeMode, accent: string) {
  return resolveColorTheme(style, themeId, mode).accent !== accent.toLowerCase()
}

function luminance(hex: string) {
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

export function contrastRatio(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// Readable text color on top of a color.
export function readableOn(hex: string) {
  return contrastRatio('#ffffff', hex) >= contrastRatio('#111111', hex) ? '#ffffff' : '#111111'
}
