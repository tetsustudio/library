import { useEffect } from 'react';

/**
 * Why this exists: Glide's overlay editor reacts to every keydown with a `setTimeout(0)`
 * that finishes the edit if a movement was recorded by then. A chord such as Shift+Tab
 * arrives as keydown Shift, then keydown Tab a millisecond or two later (fast typists,
 * automation): Tab records its movement and asks to save, but Shift's timer fires after
 * it, sees that movement with its own "do not save", and closes the editor discarding the
 * typed text. Tab alone never hits this, and neither does Shift+Tab with a gap between
 * the two keys.
 *
 * Modifier-only keydowns carry nothing for an editor (the modifier state travels on the
 * keys that follow), so they are stopped before they reach the overlay's handler.
 */

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OS', 'Hyper', 'Super', 'Symbol', 'SymbolLock']);

export const isModifierOnlyKey = (key: string): boolean => MODIFIER_KEYS.has(key);

const inOverlay = (target: EventTarget | null): boolean => target instanceof Element && !!target.closest('#portal');

export function useOverlayModifierGuard(enabled = true) {
    useEffect(() => {
        if (!enabled) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (isModifierOnlyKey(e.key) && inOverlay(e.target)) e.stopPropagation();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [enabled]);
}
