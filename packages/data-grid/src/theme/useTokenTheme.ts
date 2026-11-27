'use client';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Theme } from '@glideapps/glide-data-grid';
import { TOKEN_COLORS, errorCellTheme, themeFromTokens, toRgb, type Rgba, type TokenSnapshot } from './tokenTheme.js';

/**
 * Resolves a CSS color (including `var()`, `color-mix()`, `oklch()`) to RGBA
 * bytes by letting the browser compute it on a probe and paint it on a 1px
 * canvas: whatever the browser can paint, Glide gets as plain numbers.
 */
function resolver(host: HTMLElement) {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    host.appendChild(probe);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return {
        read(name: string): Rgba | undefined {
            const raw = getComputedStyle(host).getPropertyValue(name).trim();
            if (!raw) return undefined;
            probe.style.color = '';
            probe.style.color = `var(${name})`;
            const computed = getComputedStyle(probe).color;
            if (ctx) {
                ctx.clearRect(0, 0, 1, 1);
                ctx.fillStyle = '#000';
                ctx.fillStyle = computed;
                ctx.fillRect(0, 0, 1, 1);
                const d = ctx.getImageData(0, 0, 1, 1).data;
                if (d[3]) return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
            }
            const fallback = toRgb(computed) ?? toRgb(raw);
            return fallback ? [...fallback, 1] : undefined;
        },
        dispose: () => probe.remove(),
    };
}

export function readTokens(host: HTMLElement): TokenSnapshot {
    const r = resolver(host);
    try {
        const colors: TokenSnapshot['colors'] = {};
        for (const name of TOKEN_COLORS) {
            const value = r.read(name);
            if (value) colors[name] = value;
        }
        const fontSans = getComputedStyle(host).getPropertyValue('--font-sans').trim() || undefined;
        return fontSans ? { colors, fontSans } : { colors };
    } finally {
        r.dispose();
    }
}

const EMPTY: TokenSnapshot = { colors: {} };

/**
 * Glide theme from the token variables in scope of `ref`, recomputed when the
 * theme changes (class, style, `data-style` or `data-theme` on <html> or <body>,
 * or the system color scheme).
 */
export function useTokenTheme(ref: RefObject<HTMLElement | null>): { theme: Partial<Theme>; errorTheme: Partial<Theme> } {
    const [snapshot, setSnapshot] = useState<TokenSnapshot>(EMPTY);
    useEffect(() => {
        const host = ref.current;
        if (!host) return;
        let frame = 0;
        const update = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setSnapshot(readTokens(host)));
        };
        update();
        const observer = new MutationObserver(update);
        const attributeFilter = ['class', 'style', 'data-style', 'data-theme', 'data-palette'];
        observer.observe(document.documentElement, { attributes: true, attributeFilter });
        observer.observe(document.body, { attributes: true, attributeFilter });
        const media = window.matchMedia?.('(prefers-color-scheme: dark)');
        media?.addEventListener('change', update);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            media?.removeEventListener('change', update);
        };
    }, [ref]);
    return useMemo(() => ({ theme: themeFromTokens(snapshot), errorTheme: errorCellTheme(snapshot) }), [snapshot]);
}
