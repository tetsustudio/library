import type * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Ref callback for an overlay editor's input. It focuses synchronously on mount (during
 * commit, before any effect), so keys typed right after the editor opens are not lost.
 * Opened by typing (`initialValue`) the caret goes to the end; opened with F2/Enter the
 * current text is selected.
 */
export function useEditorFocus(initialValue: string | undefined) {
    const typedOpen = useRef(initialValue !== undefined);
    return useCallback((el: HTMLInputElement | null) => {
        if (!el) return;
        el.focus();
        if (typedOpen.current) el.setSelectionRange(el.value.length, el.value.length);
        else el.select();
    }, []);
}

/** Keeps the highlighted option of a list in view while moving with the arrow keys. */
export function useScrollActiveIntoView(list: React.RefObject<HTMLElement | null>, active: number) {
    useEffect(() => {
        (list.current?.children[active] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
    }, [list, active]);
}
