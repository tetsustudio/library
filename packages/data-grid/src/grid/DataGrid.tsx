'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
    DataEditor, GridCellKind,
    type DataEditorRef, type EditableGridCell, type GridCell, type GridColumn, type GridSelection, type Item, type Theme,
} from '@glideapps/glide-data-grid';
import {
    cellText, parseCellInput, plainTitle,
    type EditSeen, type GridColumnDef, type GridOptions, type GridRow,
} from '../model/gridModel.js';
import type { PresenceMember } from '../store/types.js';
import type { GridConnection } from '../store/createGridStore.js';
import { KEYBINDINGS } from '../theme/tokenTheme.js';
import { useTokenTheme } from '../theme/useTokenTheme.js';
import { DeleteRowsConfirm } from './DeleteRowsConfirm.js';
import { GridEditorContext } from './editors/GridEditorContext.js';
import type { SeenCell } from './editors/editorTypes.js';
import { useDeleteConfirmation } from './hooks/useDeleteConfirmation.js';
import { useGridEditors } from './hooks/useGridEditors.js';
import { useGridPresence } from './hooks/useGridPresence.js';
import { useOpenEditorPaste } from './hooks/useOpenEditorPaste.js';
import { useOverlayModifierGuard } from './hooks/useOverlayModifierGuard.js';
import { useTextInputSink } from './hooks/useTextInputSink.js';
import { DEFAULT_GRID_LABELS, type GridLabels } from './labels.js';
import { PresenceAvatars } from './PresenceAvatars.js';
import { ensureGridPortal } from './portal.js';

/**
 * Collaborative spreadsheet view (Glide Data Grid). It is presentational: the rows,
 * option lists, errors and presence come in as props and every action goes out as a
 * callback, so a sheet wires it to a store made by `createGridStore` (or uses
 * `<GridSheet store>` which does it for you).
 *
 * Keyboard: type to edit, F2 / Enter / Space open the editor, Tab / Enter confirm and
 * move, Esc cancels, Ctrl+C / Ctrl+V copy and paste blocks (also from an open editor),
 * Ctrl+Z undoes the last saved cell, Ctrl+Delete (Cmd+Delete) asks for confirmation
 * and then deletes the selected rows when `onDeleteRows` is given. Date, select and
 * multi columns open real editors.
 */

/** The row-marker column Glide prepends to the columns. */
const MARKER_OFFSET = 1;

export interface GridKeyEvent {
    ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string; cancel: () => void;
}

export interface DataGridProps<F extends string> {
    columns: GridColumnDef<F>[];
    rows: GridRow<F>[];
    options: GridOptions;
    cellErrors: Record<string, Partial<Record<F, string>>>;
    selection: GridSelection;
    onSelectionChange: (selection: GridSelection) => void;
    onEditCell: (rowKey: string, field: F, value: unknown, seen: EditSeen) => void;
    /** A typed value that could not be parsed: the sheet shows it as the cell's error. */
    onCellError: (rowKey: string, field: F, message: string) => void;
    onPaste: (target: { col: number; row: number }, block: readonly (readonly string[])[]) => void;
    onUndo: () => void;
    onAddRow: () => void;
    members?: PresenceMember[];
    connId?: string | null;
    /** `none` (no realtime) and `open` hide the "reconnecting" notice. */
    connection?: GridConnection;
    savingCount?: number;
    /** Present = Ctrl+Delete deletes the selected rows through it, after a confirmation. */
    onDeleteRows?: (rowKeys: string[]) => void;
    /** True = the row's cells cannot be edited. */
    isRowReadOnly?: (row: GridRow<F>) => boolean;
    /** True = the whole grid is read-only: no editing, no trailing new row, no paste, undo or delete. */
    readOnly?: boolean;
    /** Hint of the trailing "new row" (default `labels.newRow`). */
    newRowHint?: string;
    /** Extra buttons next to the presence avatars. */
    toolbar?: ReactNode;
    /** Sheet-specific shortcuts; runs after the grid's own. */
    onKeyDown?: (e: GridKeyEvent) => void;
    /** Merged over the theme derived from the token CSS variables. */
    theme?: Partial<Theme>;
    labels?: Partial<GridLabels>;
    className?: string;
}

const selectedRowIndexes = (selection: GridSelection): number[] => {
    if (selection.rows.length > 0) return selection.rows.toArray();
    const range = selection.current?.range;
    return range ? Array.from({ length: range.height }, (_, i) => range.y + i) : [];
};

const NO_MEMBERS: PresenceMember[] = [];

export function DataGrid<F extends string>(props: DataGridProps<F>) {
    const {
        columns, rows, options, cellErrors, members = NO_MEMBERS, connId = null, connection = 'none', savingCount = 0,
        selection, onSelectionChange, onEditCell, onCellError, onPaste, onUndo, onAddRow, onDeleteRows, isRowReadOnly,
        readOnly = false, newRowHint, toolbar, onKeyDown: onSheetKeyDown, theme: themeOverride, className,
    } = props;
    const labels = useMemo(() => ({ ...DEFAULT_GRID_LABELS, ...props.labels }), [props.labels]);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const { theme: tokenTheme, errorTheme } = useTokenTheme(rootRef);
    const gridTheme = useMemo(() => ({ ...tokenTheme, ...themeOverride }), [tokenTheme, themeOverride]);
    const portalRef = useRef<HTMLElement | null>(null);
    // Glide reads `window` while rendering, so it mounts only in the browser (after
    // hydration); the server renders the empty frame.
    const [mounted, setMounted] = useState(false);
    useEffect(() => { portalRef.current = ensureGridPortal(); setMounted(true); }, []);

    const gridRef = useRef<DataEditorRef | null>(null);
    const gridBoxRef = useRef<HTMLDivElement | null>(null);
    useTextInputSink(gridBoxRef, { enabled: !readOnly, hasSelectedCell: !!selection.current });
    useOverlayModifierGuard(!readOnly);
    const deletion = useDeleteConfirmation(onDeleteRows, () => gridRef.current?.focus());
    const editorValue = useMemo(() => ({ options, labels }), [options, labels]);
    const provideEditor = useGridEditors(columns as GridColumnDef[], MARKER_OFFSET);
    const { highlights, others } = useGridPresence(members, connId, rows as GridRow[], columns as GridColumnDef[]);

    const gridColumns = useMemo<GridColumn[]>(
        () => columns.map((c) => ({ id: c.field, title: c.title, width: c.width })),
        [columns]
    );

    const getCellContent = useCallback(([col, row]: Item): GridCell => {
        const def = columns[col]!;
        const gridRow = rows[row];
        const value = gridRow?.values[def.field];
        const text = gridRow ? cellText(def, value, options) : '';
        const hasError = !!gridRow && !!cellErrors[gridRow.key]?.[def.field];
        const locked = readOnly || !!def.readOnly || (!!gridRow && !!isRowReadOnly?.(gridRow));
        const cell: SeenCell = {
            kind: GridCellKind.Text,
            data: text,
            displayData: text,
            allowOverlay: !locked,
            readonly: locked,
            themeOverride: hasError ? errorTheme : undefined,
            // Travels with the overlay editor (`{ ...cell, data }`): what the user saw when editing started.
            __seen: gridRow ? { rowKey: gridRow.key, version: gridRow.version, base: value ?? null } : undefined,
        };
        return cell;
    }, [rows, columns, options, cellErrors, errorTheme, isRowReadOnly, readOnly]);

    const onCellEdited = useCallback(([col]: Item, newValue: EditableGridCell) => {
        if (newValue.kind !== GridCellKind.Text) return;
        const edited = newValue as SeenCell & { data: string };
        const seen = edited.__seen;
        if (!seen) return;
        const def = columns[col]!;
        // An editor that picked an option knows the exact value; an empty pick falls back to parsing.
        const picked = edited.__picked;
        const hasPick = picked !== undefined && picked !== null && !(Array.isArray(picked) && picked.length === 0);
        const parsed = hasPick ? { value: picked } : parseCellInput(def, edited.data, options);
        if ('error' in parsed) {
            onCellError(seen.rowKey, def.field, parsed.error);
            return;
        }
        if (JSON.stringify(parsed.value) === JSON.stringify(seen.base ?? null)) return;
        onEditCell(seen.rowKey, def.field, parsed.value, { version: seen.version, base: seen.base });
    }, [columns, options, onEditCell, onCellError]);

    const handlePaste = useCallback((target: Item, values: readonly (readonly string[])[]) => {
        if (readOnly) return false;
        onPaste({ col: target[0], row: target[1] }, values);
        return false;
    }, [onPaste, readOnly]);

    // A block pasted into an open editor goes to the grid paste instead of one cell.
    useOpenEditorPaste(
        () => (selection.current ? [selection.current.range.x, selection.current.range.y] : undefined),
        (target, block) => { if (!readOnly) onPaste({ col: target[0], row: target[1] }, block); }
    );

    const handleKeyDown = useCallback((e: GridKeyEvent) => {
        const mod = e.ctrlKey || e.metaKey;
        if (readOnly) {
            onSheetKeyDown?.(e);
            return;
        }
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
            e.cancel();
            onUndo();
            return;
        }
        if (mod && e.key === 'Delete' && onDeleteRows) {
            e.cancel();
            const keys = selectedRowIndexes(selection).map((i) => rows[i]?.key).filter((k): k is string => !!k);
            if (keys.length) deletion.request(keys);
            return;
        }
        onSheetKeyDown?.(e);
    }, [onUndo, onDeleteRows, deletion, selection, rows, onSheetKeyDown, readOnly]);

    const errorList = useMemo(() => rows.flatMap((r, i) => Object.entries(cellErrors[r.key] ?? {}).map(([field, msg]) => ({
        key: `${r.key}:${field}`,
        text: labels.errorRow(i + 1, plainTitle(columns.find((c) => c.field === field) ?? { title: field }), msg as string),
    }))), [rows, cellErrors, columns, labels]);

    return (
        <GridEditorContext.Provider value={editorValue}>
            <div ref={rootRef} className={className ? `tds-grid ${className}` : 'tds-grid'}>
                <div className="tds-grid__bar">
                    <div className="tds-grid__status">
                        <span data-testid="save-status">{savingCount > 0 ? labels.saving : labels.saved}</span>
                        {(connection === 'connecting' || connection === 'closed') && (
                            <span className="tds-grid__warning">{labels.reconnecting}</span>
                        )}
                        {readOnly && <span>{labels.readOnly}</span>}
                        {onDeleteRows && !readOnly && <span className="tds-grid__hint">{labels.deleteHint}</span>}
                    </div>
                    <div className="tds-grid__tools">
                        {toolbar}
                        <PresenceAvatars users={others} label={labels.presence} editingLabel={labels.editing} />
                    </div>
                </div>

                {errorList.length > 0 && (
                    <div className="tds-grid__errors">
                        <ul data-testid="grid-errors">
                            {errorList.map((e) => <li key={e.key}>{e.text}</li>)}
                        </ul>
                    </div>
                )}

                <div ref={gridBoxRef} className="tds-grid__canvas">
                    {mounted && <DataEditor
                        ref={gridRef}
                        width="100%"
                        height="100%"
                        columns={gridColumns}
                        rows={rows.length}
                        getCellContent={getCellContent}
                        onCellEdited={onCellEdited}
                        onPaste={handlePaste}
                        provideEditor={provideEditor}
                        getCellsForSelection
                        rangeSelect="rect"
                        rowMarkers="number"
                        smoothScrollX
                        smoothScrollY
                        gridSelection={selection}
                        onGridSelectionChange={onSelectionChange}
                        highlightRegions={highlights}
                        keybindings={KEYBINDINGS}
                        onKeyDown={handleKeyDown}
                        theme={gridTheme}
                        portalElementRef={portalRef as RefObject<HTMLElement>}
                        trailingRowOptions={readOnly ? undefined : { hint: newRowHint ?? labels.newRow, sticky: true, tint: true }}
                        onRowAppended={readOnly ? undefined : () => { onAddRow(); }}
                    />}
                </div>
            </div>
            <DeleteRowsConfirm count={deletion.pendingCount} onConfirm={deletion.confirm} onCancel={deletion.cancel} labels={labels} />
        </GridEditorContext.Provider>
    );
}
