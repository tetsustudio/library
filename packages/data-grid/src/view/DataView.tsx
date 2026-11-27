'use client';
import type { ReactNode } from 'react';

export type DataViewMode = 'table' | 'sheet';

export interface DataViewProps {
    /** Controlled: the app owns it (e.g. maps it to `?vista=planilla`). */
    view: DataViewMode;
    onViewChange: (view: DataViewMode) => void;
    /** Rendered in table mode (usually a `<DataTable>`). */
    table: ReactNode;
    /** Rendered in sheet mode (usually a `<GridSheet>` or `<DataGrid>`). */
    sheet: ReactNode;
    labels?: { table?: string; sheet?: string; switcher?: string };
    /** Extra content next to the switch. */
    toolbar?: ReactNode;
    className?: string;
}

/**
 * Table / spreadsheet switch for one data set. It has no router coupling: `view`
 * is controlled, so the app decides where it lives (URL, state, storage). Only the
 * active view is mounted, so leaving the sheet closes its realtime session.
 */
export function DataView({ view, onViewChange, table, sheet, labels, toolbar, className }: DataViewProps) {
    const options: { value: DataViewMode; label: string }[] = [
        { value: 'table', label: labels?.table ?? 'Tabla' },
        { value: 'sheet', label: labels?.sheet ?? 'Planilla' },
    ];
    return (
        <div className={className ? `tds-view ${className}` : 'tds-view'}>
            <div className="tds-view__bar">
                <div className="tds-segmented" role="radiogroup" aria-label={labels?.switcher ?? 'Vista'}>
                    {options.map((o) => (
                        <button key={o.value} type="button" role="radio" aria-checked={view === o.value}
                            className={view === o.value ? 'tds-segmented__item is-active' : 'tds-segmented__item'}
                            onClick={() => { if (view !== o.value) onViewChange(o.value); }}>
                            {o.label}
                        </button>
                    ))}
                </div>
                {toolbar}
            </div>
            <div className="tds-view__body">{view === 'sheet' ? sheet : table}</div>
        </div>
    );
}
