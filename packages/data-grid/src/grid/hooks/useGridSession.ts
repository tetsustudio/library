'use client';
import { useEffect, useState } from 'react';
import type { GridSelection } from '@glideapps/glide-data-grid';
import type { GridColumnDef, GridRow } from '../../model/gridModel.js';
import type { PresenceCursor } from '../../store/types.js';

/** The slice of a grid store the session needs (any store made by `createGridStore`). */
interface SessionStore {
    load: (scopeId: number) => Promise<void>;
    connect: (scopeId: number) => void;
    reset: () => void;
    sendCursor: (cursor: PresenceCursor | null) => void;
}

const isEditingElement = (el: EventTarget | null) =>
    el instanceof HTMLElement && !!el.closest('#portal') && /^(TEXTAREA|INPUT)$/.test(el.tagName);

/**
 * Lifecycle of a collaborative grid: loads the rows, joins the scope's realtime
 * room while mounted, and broadcasts my cursor (row id + column key) and whether
 * my overlay editor is open.
 */
export function useGridSession(
    store: SessionStore,
    scopeId: number,
    selection: GridSelection,
    rows: GridRow[],
    columns: GridColumnDef[]
) {
    const { load, connect, reset, sendCursor } = store;
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        void load(scopeId);
        connect(scopeId);
        return () => reset();
    }, [scopeId, load, connect, reset]);

    // Glide renders its overlay editor in #portal; focus there means "editing".
    useEffect(() => {
        const onIn = (e: FocusEvent) => setEditing(isEditingElement(e.target));
        const onOut = (e: FocusEvent) => { if (isEditingElement(e.target)) setEditing(false); };
        document.addEventListener('focusin', onIn);
        document.addEventListener('focusout', onOut);
        return () => {
            document.removeEventListener('focusin', onIn);
            document.removeEventListener('focusout', onOut);
        };
    }, []);

    const cell = selection.current?.cell;
    const range = selection.current?.range;
    const rowId = cell ? rows[cell[1]]?.id ?? null : null;
    const col = cell ? columns[cell[0]]?.field ?? null : null;
    useEffect(() => {
        if (!col || !range) { sendCursor(null); return; }
        sendCursor({ rowId, col, range: { x: range.x, y: range.y, width: range.width, height: range.height }, editing });
    }, [rowId, col, range?.x, range?.y, range?.width, range?.height, editing, sendCursor]); // eslint-disable-line react-hooks/exhaustive-deps

    return { editing };
}
