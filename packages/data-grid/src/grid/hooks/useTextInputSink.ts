import { useEffect, useRef, type RefObject } from 'react';
import { initialTextFor } from '../textInsertion.js';

/**
 * Why this exists: Chromium drops text insertion (`Input.insertText`, dead keys, IME,
 * virtual keyboards) when the focused element is not editable, before any DOM event. The
 * grid's canvas and its accessibility cells are not editable, so a first character that
 * arrives without a keydown (e.g. "Ñ" typed by automation, or a composed "ñ") never
 * reached the grid and "Ñandú" was saved as "andú".
 *
 * While the grid has focus and no editor is open, focus rests on a 1px transparent
 * textarea placed inside Glide's scroller (so Glide's copy/paste still see the grid as
 * focused). It is transparent to the grid:
 * - keydown is re-dispatched on the canvas, where Glide handles it as always, and
 *   `preventDefault` is mirrored back, so nothing is typed twice;
 * - text that arrives as input (or a finished composition) starts editing the selected
 *   cell exactly as a printable keydown would;
 * - the canvas keeps looking focused (its blur is hidden from Glide while focus is on
 *   the sink and replayed when focus really leaves the grid).
 */

const CANVAS = 'canvas[data-testid="data-grid-canvas"]';
const EDITOR = '#portal textarea, #portal input';

const keyInit = (e: KeyboardEvent): KeyboardEventInit & { keyCode: number; which: number } => ({
    key: e.key, code: e.code, location: e.location, repeat: e.repeat,
    ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey,
    keyCode: e.keyCode, which: e.which, bubbles: true, cancelable: true,
});

const dispatchKey = (canvas: HTMLElement, init: KeyboardEventInit): boolean => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(event);
    return event.defaultPrevented;
};

/** Puts `text` in the overlay editor Glide is opening (it mounts a frame or two later). */
function fillOpeningEditor(text: string, frames = 60) {
    const editor = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(EDITOR);
    if (!editor) {
        if (frames > 0) requestAnimationFrame(() => fillOpeningEditor(text, frames - 1));
        return;
    }
    const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.setSelectionRange(text.length, text.length);
}

export function useTextInputSink(
    containerRef: RefObject<HTMLElement | null>,
    options: { enabled: boolean; hasSelectedCell: boolean }
) {
    const latest = useRef(options);
    useEffect(() => { latest.current = options; });

    const { enabled } = options;
    useEffect(() => {
        const container = containerRef.current;
        if (!enabled || !container) return;

        let sink: HTMLTextAreaElement | null = null;
        let handledBeforeInput = false;
        const canvas = () => container.querySelector<HTMLElement>(CANVAS);
        const inGrid = (n: EventTarget | null) => n instanceof Node && !!canvas()?.contains(n);

        const startEditing = (text: string) => {
            const target = canvas();
            if (!target) return;
            const state = { hasSelectedCell: latest.current.hasSelectedCell, overlayOpen: !!document.querySelector(EDITOR) };
            const initial = initialTextFor({ type: 'beforeinput', inputType: 'insertText', data: text }, state);
            if (initial === null) return;
            // A single UTF-16 unit is what Glide's own type-to-edit accepts; longer text opens the editor
            // like F2 and replaces its content.
            if (initial.length === 1) dispatchKey(target, { key: initial });
            else if (dispatchKey(target, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })) fillOpeningEditor(initial);
        };

        const ensureSink = (): HTMLTextAreaElement | null => {
            if (sink?.isConnected) return sink;
            const parent = container.querySelector('.dvn-scroller');
            if (!parent) return null;
            const el = document.createElement('textarea');
            el.setAttribute('aria-hidden', 'true');
            el.setAttribute('autocomplete', 'off');
            el.setAttribute('autocapitalize', 'off');
            el.setAttribute('spellcheck', 'false');
            el.tabIndex = -1;
            el.dataset.testid = 'grid-text-sink';
            el.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;padding:0;border:0;resize:none;overflow:hidden;pointer-events:none;';
            el.addEventListener('beforeinput', (e) => {
                const composing = e.isComposing;
                const state = { hasSelectedCell: latest.current.hasSelectedCell, overlayOpen: !!document.querySelector(EDITOR) };
                const text = initialTextFor({ type: 'beforeinput', inputType: e.inputType, data: e.data, isComposing: composing }, state);
                if (composing) return; // let the composition run; compositionend delivers it
                e.preventDefault();
                if (text === null) return;
                handledBeforeInput = true;
                setTimeout(() => { handledBeforeInput = false; }, 0);
                startEditing(text);
            });
            el.addEventListener('input', (e) => {
                const ie = e as InputEvent;
                const value = el.value;
                if (!ie.isComposing) el.value = '';
                if (handledBeforeInput || ie.isComposing || !value) return;
                const state = { hasSelectedCell: latest.current.hasSelectedCell, overlayOpen: !!document.querySelector(EDITOR) };
                const text = initialTextFor({ type: 'input', inputType: ie.inputType, data: ie.data ?? value, isComposing: false }, state);
                if (text !== null) startEditing(text);
            });
            el.addEventListener('compositionend', (e) => {
                el.value = '';
                const state = { hasSelectedCell: latest.current.hasSelectedCell, overlayOpen: !!document.querySelector(EDITOR) };
                const text = initialTextFor({ type: 'compositionend', data: e.data }, state);
                if (text !== null) startEditing(text);
            });
            parent.appendChild(el);
            sink = el;
            return el;
        };

        // The grid took focus (click, programmatic focus, an editor closing): rest it on the sink.
        const onFocusIn = (e: FocusEvent) => {
            if (!inGrid(e.target)) return;
            ensureSink()?.focus({ preventScroll: true });
        };
        // While the sink holds focus the canvas still looks focused to Glide.
        const onFocusOut = (e: FocusEvent) => {
            if (e.target === sink) {
                if (!inGrid(e.relatedTarget)) canvas()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: e.relatedTarget }));
                return;
            }
            if (sink && e.relatedTarget === sink && inGrid(e.target)) e.stopPropagation();
        };
        // Keys typed on the sink are the grid's keys: Glide gets them on its canvas, once.
        const onKeyDown = (e: KeyboardEvent) => {
            if (!sink || e.target !== sink || !e.isTrusted) return;
            if (e.isComposing || e.key === 'Process' || e.key === 'Dead' || e.keyCode === 229) return;
            e.stopPropagation();
            const target = canvas();
            if (!target) return;
            if (dispatchKey(target, keyInit(e))) e.preventDefault();
        };

        container.addEventListener('focusin', onFocusIn, true);
        container.addEventListener('focusout', onFocusOut, true);
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            container.removeEventListener('focusin', onFocusIn, true);
            container.removeEventListener('focusout', onFocusOut, true);
            window.removeEventListener('keydown', onKeyDown, true);
            if (sink && document.activeElement === sink) canvas()?.focus({ preventScroll: true });
            sink?.remove();
            sink = null;
        };
    }, [containerRef, enabled]);
}
