'use client';
import { useState } from 'react';
import { CompactSelection, type GridSelection } from '@glideapps/glide-data-grid';
import type { ApiRowBase } from '../store/types.js';
import type { GridStore } from '../store/createGridStore.js';
import { DataGrid, type DataGridProps } from './DataGrid.js';
import { useGridSession } from './hooks/useGridSession.js';

const EMPTY_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };

export type GridSheetProps<A extends ApiRowBase, F extends string> = {
    store: GridStore<A, F>;
    /** The scope the store loads and joins (a company, a store...). */
    scopeId: number;
} & Pick<DataGridProps<F>, 'columns' | 'isRowReadOnly' | 'readOnly' | 'newRowHint' | 'toolbar' | 'onKeyDown' | 'theme' | 'labels' | 'className'> & {
    /** False = no Ctrl+Delete (default true when the transport can delete). */
    allowDelete?: boolean;
};

/**
 * A `DataGrid` wired to a store from `createGridStore`: loads the scope on mount,
 * joins its realtime room, shares the cursor and resets on unmount.
 */
export function GridSheet<A extends ApiRowBase, F extends string>({ store, scopeId, allowDelete = true, ...grid }: GridSheetProps<A, F>) {
    const s = store();
    const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION);
    useGridSession(s, scopeId, selection, s.rows, grid.columns);
    return (
        <DataGrid<F>
            {...grid}
            rows={s.rows}
            options={s.options}
            cellErrors={s.cellErrors}
            members={s.members}
            connId={s.connId}
            connection={s.connection}
            savingCount={s.savingCount}
            selection={selection}
            onSelectionChange={setSelection}
            onEditCell={(key, field, value, seen) => { void s.editCell(key, field, value, seen); }}
            onCellError={s.setCellError}
            onPaste={(target, block) => { void s.paste(target, block); }}
            onUndo={() => { void s.undo(); }}
            onAddRow={() => { s.addDraftRow(); }}
            onDeleteRows={allowDelete ? (keys) => { void s.deleteRows(keys); } : undefined}
        />
    );
}
