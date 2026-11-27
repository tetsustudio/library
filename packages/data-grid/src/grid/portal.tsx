'use client';

/**
 * Glide Data Grid renders its overlay editors into `#portal`. `ensureGridPortal`
 * creates that element on `<body>` when it is missing (the DataGrid calls it on
 * mount), and `<GridPortal />` lets an app place it explicitly instead (e.g. in a
 * Next.js root layout).
 */
export const GRID_PORTAL_ID = 'portal';

const PORTAL_STYLE = 'position:fixed;left:0;top:0;z-index:9999;';

export function ensureGridPortal(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    const existing = document.getElementById(GRID_PORTAL_ID);
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = GRID_PORTAL_ID;
    el.setAttribute('style', PORTAL_STYLE);
    document.body.appendChild(el);
    return el;
}

export function GridPortal() {
    return <div id={GRID_PORTAL_ID} style={{ position: 'fixed', left: 0, top: 0, zIndex: 9999 }} />;
}
