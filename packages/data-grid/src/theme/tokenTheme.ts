import type { Theme } from '@glideapps/glide-data-grid';

/**
 * Glide paints on a canvas and does its own color math, so it needs plain
 * `rgb()` / `rgba()` strings: no `var()`, `color-mix()` or `oklch()`. This module
 * maps resolved token colors (RGBA bytes) to Glide's theme. Pure: no DOM.
 */

export type Rgba = readonly [number, number, number, number];

/** The token variables the grid reads (from @tetsustudio/tokens). */
export const TOKEN_COLORS = [
    '--background', '--foreground', '--surface', '--border', '--brand', '--brand-foreground',
    '--muted-foreground', '--accent', '--destructive', '--warning',
] as const;
export type TokenColor = (typeof TOKEN_COLORS)[number];
export const TOKEN_FONTS = ['--font-sans', '--font-mono'] as const;

export interface TokenSnapshot {
    colors: Partial<Record<TokenColor, Rgba>>;
    fontSans?: string;
}

const rgb = ([r, g, b]: Rgba) => `rgb(${r}, ${g}, ${b})`;
const rgba = ([r, g, b]: Rgba, a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

/** Mixes `top` over `bottom` at `amount` (0..1), as an opaque color. */
export const mix = (top: Rgba, bottom: Rgba, amount: number): Rgba => [
    Math.round(top[0] * amount + bottom[0] * (1 - amount)),
    Math.round(top[1] * amount + bottom[1] * (1 - amount)),
    Math.round(top[2] * amount + bottom[2] * (1 - amount)),
    1,
];

const luminance = ([r, g, b]: Rgba) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** Glide theme from the resolved tokens. Missing tokens keep Glide's defaults. */
export function themeFromTokens({ colors: c, fontSans }: TokenSnapshot): Partial<Theme> {
    const theme: Partial<Theme> = {};
    const bg = c['--background'];
    const fg = c['--foreground'];
    const surface = c['--surface'] ?? bg;
    const border = c['--border'] ?? (fg && bg ? mix(fg, bg, 0.12) : undefined);
    const muted = c['--muted-foreground'] ?? (fg && bg ? mix(fg, bg, 0.55) : undefined);
    const hover = c['--accent'] ?? border;
    const brand = c['--brand'];

    if (bg) theme.bgCell = rgb(bg);
    if (surface) { theme.bgCellMedium = rgb(surface); theme.bgHeader = rgb(surface); theme.bgBubble = rgb(surface); }
    if (hover) { theme.bgHeaderHasFocus = rgb(hover); theme.bgHeaderHovered = rgb(hover); }
    if (fg) { theme.textDark = rgb(fg); theme.textHeader = rgb(fg); theme.textBubble = rgb(fg); }
    if (muted) { theme.textMedium = rgb(muted); theme.textLight = rgb(muted); theme.textGroupHeader = rgb(muted); }
    if (border) { theme.borderColor = rgb(border); theme.horizontalBorderColor = rgb(border); theme.drilldownBorder = rgb(border); }
    if (brand) {
        theme.accentColor = rgb(brand);
        theme.accentFg = c['--brand-foreground'] ? rgb(c['--brand-foreground']) : luminance(brand) > 0.6 ? '#000000' : '#ffffff';
        theme.textHeaderSelected = theme.accentFg;
        theme.accentLight = rgba(brand, bg && luminance(bg) < 0.5 ? 0.3 : 0.15);
    }
    if (c['--warning'] && bg) theme.bgSearchResult = rgb(mix(c['--warning'], bg, 0.3));
    if (fontSans) { theme.fontFamily = fontSans; theme.headerFontStyle = '600 13px'; }
    return theme;
}

/** Theme override for a cell with an error: the destructive tone over the background. */
export function errorCellTheme({ colors: c }: TokenSnapshot): Partial<Theme> {
    const bg = c['--background'] ?? [255, 255, 255, 1];
    const danger = c['--destructive'] ?? [239, 68, 68, 1];
    return { bgCell: rgb(mix(danger, bg, luminance(bg) < 0.5 ? 0.3 : 0.16)) };
}

/** Space and F2 open the editor like Enter does; the rest are Glide's defaults. */
export const KEYBINDINGS = { activateCell: ' |Enter|shift+Enter|F2' };

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v * 255)));
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * `#rgb`, `#rrggbb`, `rgb()/rgba()` or `oklch(L C H)` as [r, g, b]; null otherwise.
 * Used where no browser is available to resolve a color (SSR, tests).
 */
export const toRgb = (color: string | undefined): [number, number, number] | null => {
    const value = color?.trim().toLowerCase() ?? '';
    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hex?.[1]) {
        const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
        return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    }
    const rgbMatch = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (rgbMatch) return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])].map(Math.round) as [number, number, number];
    const oklch = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/);
    if (!oklch) return null;
    const l = parseFloat(oklch[1]!) / (oklch[2] ? 100 : 1);
    const c = parseFloat(oklch[3]!);
    const h = (parseFloat(oklch[4]!) * Math.PI) / 180;
    const a = c * Math.cos(h);
    const b = c * Math.sin(h);
    // OKLab -> linear sRGB (Ottosson)
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
    const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
    const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
    return [clamp255(linearToSrgb(r)), clamp255(linearToSrgb(g)), clamp255(linearToSrgb(bl))];
};
