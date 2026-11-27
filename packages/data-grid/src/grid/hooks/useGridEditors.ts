import { useCallback, useMemo } from 'react';
import type { GridCell, ProvideEditorCallback } from '@glideapps/glide-data-grid';
import type { GridColumnDef } from '../../model/gridModel.js';
import { buildColumnEditors } from '../editors/provideGridEditor.js';

/**
 * `provideEditor` for Glide: the editor of the column the overlay opened on. Glide gives
 * the location with the row-marker column included, hence `markerOffset`.
 */
export function useGridEditors(columns: GridColumnDef[], markerOffset: number): ProvideEditorCallback<GridCell> {
    const editors = useMemo(() => buildColumnEditors(columns), [columns]);
    return useCallback((cell) => (cell.location ? editors[cell.location[0] - markerOffset] : undefined), [editors, markerOffset]);
}
