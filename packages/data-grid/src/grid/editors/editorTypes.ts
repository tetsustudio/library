import type * as React from 'react';
import type { GridCell, ProvideEditorComponent } from '@glideapps/glide-data-grid';
import type { EditSeen } from '../../model/gridModel.js';

export type EditorProps = React.ComponentProps<ProvideEditorComponent<GridCell>>;

/**
 * Text cell as the grid builds it. `__seen` is what the user saw when editing started;
 * `__picked` is the exact API value an editor chose (an option id or list of ids), so a
 * pick never depends on re-parsing the shown name.
 */
export type SeenCell = GridCell & { __seen?: EditSeen & { rowKey: string }; __picked?: unknown };

export const withText = (value: GridCell, data: string, picked?: unknown): GridCell =>
    ({ ...value, data, displayData: data, ...(picked !== undefined ? { __picked: picked } : {}) }) as GridCell;

export const textOf = (value: GridCell): string => (value.kind === 'text' ? String((value as { data: unknown }).data ?? '') : '');

/** Case- and accent-insensitive form used to filter option lists. */
export const normalize = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const LIST_STYLE: React.CSSProperties = {
    margin: 0, padding: 0, listStyle: 'none', maxHeight: 220, overflowY: 'auto', borderTop: '1px solid var(--gdg-border-color)',
};
export const ROOT_STYLE: React.CSSProperties = { minWidth: 240, color: 'var(--gdg-text-dark)' };
export const INPUT_STYLE: React.CSSProperties = {
    width: '100%', padding: '6px 8px', background: 'transparent', color: 'inherit', font: 'inherit',
};
export const optionStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 8px', cursor: 'pointer', whiteSpace: 'nowrap',
    background: active ? 'var(--gdg-accent-light)' : 'transparent',
});
export const HINT_STYLE: React.CSSProperties = {
    padding: '4px 8px', fontSize: 11, color: 'var(--gdg-text-light)', borderTop: '1px solid var(--gdg-border-color)',
};
