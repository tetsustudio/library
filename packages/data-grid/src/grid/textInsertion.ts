/**
 * Decides whether a text insertion that reached the grid (no keydown behind it) must
 * start editing the selected cell. Pure: no DOM, no React.
 *
 * Glide only starts "type to edit" from a printable `keydown`. Text that arrives as an
 * input event instead (a character the keyboard layout has no key for, a dead key, an
 * IME composition, a virtual keyboard) never produces one, so its first character used
 * to be lost.
 */

export interface TextInsertionEvent {
    type: 'beforeinput' | 'input' | 'compositionend';
    inputType?: string;
    data?: string | null;
    isComposing?: boolean;
}

export interface GridTextState {
    /** A cell is selected, so there is a cell to edit. */
    hasSelectedCell: boolean;
    /** An overlay editor is already open: it receives the text itself. */
    overlayOpen: boolean;
}

/** Input types that carry typed text. Paste, deletion, undo and line breaks are not typing. */
const TYPED = new Set(['insertText', 'insertReplacementText']);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The text to start editing with, or `null` when the event must be ignored. */
export function initialTextFor(event: TextInsertionEvent, state: GridTextState): string | null {
    if (!state.hasSelectedCell || state.overlayOpen) return null;
    const data = event.data ?? '';
    if (data === '' || CONTROL.test(data)) return null;
    // The composed text is final only when the composition ends; its updates are not.
    if (event.type === 'compositionend') return data;
    if (event.isComposing) return null;
    return TYPED.has(event.inputType ?? '') ? data : null;
}
