import type { GridCell, ProvideEditorCallback } from '@glideapps/glide-data-grid';
import type { GridColumnDef } from '../../model/gridModel.js';
import { DateEditor } from './DateEditor.js';
import { makeMultiSelectEditor } from './MultiSelectEditor.js';
import { makeSelectEditor } from './SelectEditor.js';

type Provided = ReturnType<ProvideEditorCallback<GridCell>>;

/**
 * One editor per column that needs more than the plain text box (date, select, multi);
 * the rest return undefined and keep Glide's text editor. Built once per column list: a new
 * component identity would remount an open editor and drop what was typed.
 */
export const buildColumnEditors = (columns: GridColumnDef[]): Provided[] =>
    columns.map((col): Provided => {
        if (col.kind === 'date') return { editor: DateEditor, disablePadding: false };
        if (col.kind === 'select') return { editor: makeSelectEditor(col), disablePadding: true };
        if (col.kind === 'multi') return { editor: makeMultiSelectEditor(col), disablePadding: true };
        return undefined;
    });
