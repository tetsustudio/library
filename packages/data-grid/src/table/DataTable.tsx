'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { DEFAULT_TABLE_LABELS, type TableLabels } from './labels.js';

/**
 * Table view: a read-mostly list with search, filters, column visibility, density,
 * row selection, per-row actions and pagination. Plain HTML and `tds-` classes that
 * read the token CSS variables; no Tailwind needed.
 */

export interface DataTableColumn<T = Record<string, unknown>> {
    header: ReactNode;
    accessor: keyof T | ((row: T) => ReactNode);
    className?: string;
    headerClassName?: string;
    cellClassName?: string;
}

export interface PaginationInfo {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
}

type RowId = string | number;

export interface DataTableProps<T extends { id: RowId }> {
    data?: T[];
    columns?: DataTableColumn<T>[];
    loading?: boolean;
    pagination?: PaginationInfo | null;
    onPageChange?: (page: number) => void;
    /** Debounced (500 ms) search; present = the search box is shown. */
    onSearch?: (query: string) => void;
    onCreate?: () => void;
    onUpdate?: (row: T) => void;
    onDelete?: (id: RowId) => void;
    onRestore?: (id: RowId) => void;
    searchPlaceholder?: string;
    searchValue?: string;
    createButtonLabel?: string;
    emptyText?: string;
    filterContent?: ReactNode;
    footer?: ReactNode;
    selectionMode?: 'single' | 'multiple' | null;
    selectedRows?: RowId[];
    onSelectionChange?: (updater: (prev: RowId[]) => RowId[]) => void;
    isRowSelectable?: (row: T) => boolean;
    renderNonSelectableCell?: ((row: T) => ReactNode) | null;
    isDeletable?: (row: T) => boolean;
    isEditable?: (row: T) => boolean;
    isRestorable?: (row: T) => boolean;
    onRowClick?: ((row: T) => void) | null;
    /** Extra content at the end of the toolbar (e.g. the view switch). */
    toolbar?: ReactNode;
    labels?: Partial<TableLabels>;
    className?: string;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

const Icon = ({ d, fill = false }: { d: string; fill?: boolean }) => (
    <svg className="tds-icon" viewBox="0 0 24 24" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
    </svg>
);
const ICONS = {
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35',
    clear: 'M18 6 6 18M6 6l12 12',
    plus: 'M12 5v14M5 12h14',
    filter: 'M3 5h18l-7 8v6l-4 2v-8z',
    density: 'M4 6h16M4 10h16M4 14h16M4 18h16',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
    edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    restore: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
    spinner: 'M12 3a9 9 0 1 0 9 9',
};

function SearchInput({ onSearch, placeholder, value = '', clearLabel }: { onSearch: (q: string) => void; placeholder: string; value?: string; clearLabel: string }) {
    const [term, setTerm] = useState(value);
    const notified = useRef(value);
    const latest = useRef(onSearch);
    useEffect(() => { latest.current = onSearch; });
    // Mirror a controlled value into the local buffer.
    useEffect(() => { notified.current = value; setTerm(value); }, [value]);
    useEffect(() => {
        if (term === notified.current) return;
        const t = setTimeout(() => { notified.current = term; latest.current(term); }, 500);
        return () => clearTimeout(t);
    }, [term]);
    return (
        <div className="tds-search">
            <Icon d={ICONS.search} />
            <input className="tds-input" autoCapitalize="none" placeholder={placeholder} value={term} onChange={(e) => setTerm(e.target.value)} />
            {term && (
                <button type="button" className="tds-icon-button tds-icon-button--sm" aria-label={clearLabel} onClick={() => setTerm('')}>
                    <Icon d={ICONS.clear} />
                </button>
            )}
        </div>
    );
}

function ColumnToggle<T>({ columns, hidden, onToggle, label }: { columns: DataTableColumn<T>[]; hidden: Set<number>; onToggle: (i: number) => void; label: string }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);
    const toggleable = columns
        .map((col, index) => ({ col, index }))
        .filter(({ col }) => col.header && (typeof col.header === 'string' ? col.header.trim() !== '' : true));
    const visibleCount = toggleable.filter(({ index }) => !hidden.has(index)).length;
    return (
        <div className="tds-popover-anchor" ref={ref}>
            <button type="button" className={cx('tds-icon-button', hidden.size > 0 && 'is-active')} title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
                <Icon d={hidden.size > 0 ? ICONS.eyeOff : ICONS.eye} />
            </button>
            {open && (
                <div className="tds-popover">
                    {toggleable.map(({ col, index }) => {
                        const visible = !hidden.has(index);
                        const last = visible && visibleCount === 1;
                        return (
                            <label key={index} className={cx('tds-popover__item', last && 'is-disabled')}>
                                <input type="checkbox" className="tds-checkbox" checked={visible} disabled={last} onChange={() => onToggle(index)} />
                                <span>{col.header}</span>
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function Pagination({ info, onPageChange, labels }: { info: PaginationInfo; onPageChange: (page: number) => void; labels: TableLabels }) {
    const { currentPage, totalPages, totalItems, itemsPerPage } = info;
    if (totalPages <= 1 && totalItems <= itemsPerPage) return null;
    const from = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const to = Math.min(currentPage * itemsPerPage, totalItems);
    return (
        <nav className="tds-pagination" aria-label={labels.pagination}>
            <span>{labels.range(from, to, totalItems)}</span>
            <div className="tds-pagination__buttons">
                <button type="button" className="tds-button tds-button--sm" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>{labels.previous}</button>
                <span>{labels.page(currentPage, Math.max(totalPages, 1))}</span>
                <button type="button" className="tds-button tds-button--sm" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>{labels.next}</button>
            </div>
        </nav>
    );
}

function DataTableInner<T extends { id: RowId }>({
    data = [],
    columns = [],
    loading = false,
    pagination = null,
    onPageChange,
    onSearch,
    onCreate,
    onUpdate,
    onDelete,
    onRestore,
    searchPlaceholder,
    searchValue = '',
    createButtonLabel,
    emptyText,
    filterContent = null,
    footer = null,
    selectionMode = null,
    selectedRows = [],
    onSelectionChange,
    isRowSelectable = () => true,
    renderNonSelectableCell = null,
    isDeletable = () => true,
    isEditable = () => true,
    isRestorable = () => false,
    onRowClick = null,
    toolbar = null,
    labels: labelOverrides,
    className,
}: DataTableProps<T>) {
    const labels = useMemo(() => ({ ...DEFAULT_TABLE_LABELS, ...labelOverrides }), [labelOverrides]);
    const [showMobileFilters, setShowMobileFilters] = useState(false);
    const [compact, setCompact] = useState(false);
    const [hidden, setHidden] = useState(new Set<number>());

    const toggleColumn = useCallback((i: number) => {
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
        });
    }, []);

    const visibleColumns = useMemo(() => columns.filter((_, i) => !hidden.has(i)), [columns, hidden]);
    const hiddenCount = columns.length - visibleColumns.length;

    const handleSelectAll = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        if (!onSelectionChange) return;
        if (e.target.checked) {
            const ids = data.filter((row) => isRowSelectable(row)).map((row) => row.id);
            onSelectionChange((prev) => [...new Set([...prev, ...ids])]);
        } else {
            const pageIds = data.map((row) => row.id);
            onSelectionChange((prev) => prev.filter((id) => !pageIds.includes(id)));
        }
    }, [data, isRowSelectable, onSelectionChange]);

    const handleSelectRow = useCallback((id: RowId, checked: boolean) => {
        if (!onSelectionChange) return;
        if (selectionMode === 'single') onSelectionChange(() => (checked ? [id] : []));
        else if (checked) onSelectionChange((prev) => [...prev, id]);
        else onSelectionChange((prev) => prev.filter((x) => x !== id));
    }, [onSelectionChange, selectionMode]);

    const selectable = data.filter((row) => isRowSelectable(row));
    const allSelected = data.length > 0 && selectable.every((row) => selectedRows.includes(row.id));
    const anySelected = data.some((row) => selectedRows.includes(row.id));
    const selectedCount = selectedRows.filter((id) => data.some((row) => row.id === id)).length;

    const showActions = !!(onUpdate || onDelete || onRestore);
    const hints = [
        selectionMode === 'multiple' && selectedCount > 0 ? labels.selected(selectedCount) : null,
        selectionMode === 'multiple' && selectable.length > 0 && selectable.length !== data.length ? labels.selectable(selectable.length) : null,
        hiddenCount > 0 ? labels.hiddenColumns(hiddenCount) : null,
    ].filter((h): h is string => !!h);
    const colSpan = visibleColumns.length + (showActions ? 1 : 0) + (selectionMode === 'multiple' ? 1 : 0);

    return (
        <div className={cx('tds-table', compact && 'tds-table--compact', className)}>
            {(onSearch || onCreate || filterContent || toolbar) && (
                <div className="tds-table__toolbar">
                    <div className="tds-table__toolbar-row">
                        {onSearch && <SearchInput onSearch={onSearch} placeholder={searchPlaceholder ?? labels.search} value={searchValue} clearLabel={labels.clear} />}
                        {filterContent && <div className="tds-table__filters">{filterContent}</div>}
                        {filterContent && (
                            <button type="button" className="tds-icon-button tds-table__filters-toggle" aria-label={labels.showFilters} onClick={() => setShowMobileFilters(!showMobileFilters)}>
                                <Icon d={ICONS.filter} />
                            </button>
                        )}
                        <div className="tds-table__toolbar-end">
                            {onCreate && (
                                <button type="button" className="tds-button tds-button--primary tds-button--sm" onClick={onCreate}>
                                    <Icon d={ICONS.plus} />
                                    {createButtonLabel ?? labels.create}
                                </button>
                            )}
                            <ColumnToggle columns={columns} hidden={hidden} onToggle={toggleColumn} label={labels.columns} />
                            <button type="button" className={cx('tds-icon-button', compact && 'is-active')} title={labels.density} aria-label={labels.density} aria-pressed={compact} onClick={() => setCompact(!compact)}>
                                <Icon d={ICONS.density} />
                            </button>
                            {toolbar}
                        </div>
                    </div>
                    {hints.length > 0 && <div className="tds-table__hints">{hints.map((h) => <span key={h}>{h}</span>)}</div>}
                    {filterContent && showMobileFilters && <div className="tds-table__filters-mobile">{filterContent}</div>}
                </div>
            )}

            <div className={cx('tds-table__refreshing', loading && data.length > 0 && 'is-visible')} role="status" aria-live="polite" aria-hidden={!(loading && data.length > 0)}>
                <span className="tds-spin"><Icon d={ICONS.spinner} /></span>
                {labels.refreshing}
            </div>

            <div className="tds-table__scroll">
                <table className="tds-table__table">
                    <thead>
                        <tr>
                            {selectionMode === 'multiple' && (
                                <th className="tds-table__check">
                                    <input
                                        type="checkbox"
                                        className="tds-checkbox"
                                        aria-label={labels.selectAll}
                                        checked={allSelected}
                                        onChange={handleSelectAll}
                                        ref={(input) => { if (input) input.indeterminate = !allSelected && anySelected; }}
                                    />
                                </th>
                            )}
                            {visibleColumns.map((col, i) => (
                                <th key={i} className={cx(col.className, col.headerClassName)}>{col.header}</th>
                            ))}
                            {showActions && <th className="tds-table__actions" />}
                        </tr>
                    </thead>
                    <tbody>
                        {loading && data.length === 0 ? (
                            Array.from({ length: 8 }, (_, i) => (
                                <tr key={i} className="tds-table__skeleton" aria-hidden="true">
                                    {Array.from({ length: Math.max(colSpan, 1) }, (_, j) => <td key={j}><span /></td>)}
                                </tr>
                            ))
                        ) : data.length === 0 ? (
                            <tr>
                                <td colSpan={Math.max(colSpan, 1)} className="tds-table__empty">
                                    <strong>{labels.emptyTitle}</strong>
                                    <span>{emptyText ?? labels.empty}</span>
                                </td>
                            </tr>
                        ) : (
                            data.map((row, rowIndex) => {
                                const selected = selectedRows.includes(row.id);
                                return (
                                    <tr
                                        key={row.id ?? rowIndex}
                                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                                        className={cx(selected && 'is-selected', onRowClick && 'is-clickable')}
                                        aria-selected={selectionMode ? selected : undefined}
                                    >
                                        {selectionMode === 'multiple' && (
                                            <td className="tds-table__check" onClick={(e) => e.stopPropagation()}>
                                                {isRowSelectable(row) ? (
                                                    <input type="checkbox" className="tds-checkbox" aria-label={labels.selectRow} checked={selected}
                                                        onChange={(e) => handleSelectRow(row.id, e.target.checked)} />
                                                ) : renderNonSelectableCell?.(row)}
                                            </td>
                                        )}
                                        {visibleColumns.map((col, i) => (
                                            <td key={i} className={cx(col.className, col.cellClassName)}>
                                                {typeof col.accessor === 'function' ? col.accessor(row) : (row[col.accessor] as ReactNode)}
                                            </td>
                                        ))}
                                        {showActions && (
                                            <td className="tds-table__actions">
                                                {onUpdate && isEditable(row) && (
                                                    <button type="button" className="tds-icon-button tds-icon-button--sm" aria-label={labels.edit}
                                                        onClick={(e) => { e.stopPropagation(); onUpdate(row); }}>
                                                        <Icon d={ICONS.edit} />
                                                    </button>
                                                )}
                                                {onDelete && isDeletable(row) && (
                                                    <button type="button" className="tds-icon-button tds-icon-button--sm tds-icon-button--danger" aria-label={labels.delete}
                                                        onClick={(e) => { e.stopPropagation(); onDelete(row.id); }}>
                                                        <Icon d={ICONS.trash} />
                                                    </button>
                                                )}
                                                {onRestore && isRestorable(row) && (
                                                    <button type="button" className="tds-icon-button tds-icon-button--sm tds-icon-button--success" aria-label={labels.restore}
                                                        onClick={(e) => { e.stopPropagation(); onRestore(row.id); }}>
                                                        <Icon d={ICONS.restore} />
                                                    </button>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                    {footer && <tfoot>{footer}</tfoot>}
                </table>
            </div>

            {onPageChange && pagination && (
                <div className="tds-table__footer">
                    <Pagination info={pagination} onPageChange={onPageChange} labels={labels} />
                </div>
            )}
        </div>
    );
}

export const DataTable = memo(DataTableInner) as typeof DataTableInner;
