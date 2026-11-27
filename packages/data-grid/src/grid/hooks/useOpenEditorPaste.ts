import { useEffect, useRef } from 'react';
import { isBlockClipboard, parseClipboardBlock } from '../../model/gridModel.js';

type Target = readonly [number, number];
type Block = readonly (readonly string[])[];

const isOverlayInput = (el: EventTarget | null): el is HTMLElement =>
    el instanceof HTMLElement && !!el.closest('#portal') && /^(TEXTAREA|INPUT)$/.test(el.tagName);

/**
 * Pasting a block (clipboard text with a tab or a line break) while an overlay
 * editor is open would drop the whole block into one cell. This cancels the
 * edit (Esc, so the cell keeps its value) and hands the block to the grid paste
 * at the selected cell. A single value still pastes into the editor as usual.
 */
export function useOpenEditorPaste(
    getTarget: () => Target | undefined,
    onBlockPaste: (target: Target, block: Block) => void
) {
    const latest = useRef({ getTarget, onBlockPaste });
    useEffect(() => { latest.current = { getTarget, onBlockPaste }; });

    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            const input = e.target;
            if (!isOverlayInput(input)) return;
            const text = e.clipboardData?.getData('text/plain') ?? '';
            if (!isBlockClipboard(text)) return;
            const target = latest.current.getTarget();
            if (!target) return;
            e.preventDefault();
            e.stopPropagation();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            latest.current.onBlockPaste(target, parseClipboardBlock(text));
        };
        document.addEventListener('paste', onPaste, true);
        return () => document.removeEventListener('paste', onPaste, true);
    }, []);
}
