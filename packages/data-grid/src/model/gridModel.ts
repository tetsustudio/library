/**
 * Pure model of a collaborative grid: column definitions as data, cell text <->
 * API value conversion and the paste-to-batch mapping. No React, no HTTP.
 * Each sheet (providers, journal entries...) is a list of `GridColumnDef`.
 */

export interface Option { id: number; name: string }

/** Selectable options by key; a column points at its list with `optionsKey`. */
export type GridOptions = Record<string, Option[]>;

export type ColumnKind = 'text' | 'number' | 'date' | 'enum' | 'select' | 'multi';

export interface GridColumnDef<F extends string = string> {
    field: F;
    title: string;
    width: number;
    kind: ColumnKind;
    required?: boolean;
    /** Message for an empty required text cell (default "Campo obligatorio"). */
    requiredMessage?: string;
    /** `select` and `multi`: key of the option list in `GridOptions`. */
    optionsKey?: string;
    /** `enum`: the allowed values. */
    values?: string[];
    /** `number`: accept decimals (comma or dot) instead of integers only. */
    decimals?: boolean;
    /** Context column: shown but never edited (cells are read-only and a paste skips them). */
    readOnly?: boolean;
}

export type RowValues<F extends string = string> = Partial<Record<F, unknown>>;

export interface GridRow<F extends string = string> {
    /** Server id as string, or `draft:<n>` for a row not created yet. */
    key: string;
    id?: number;
    version?: number;
    values: RowValues<F>;
}

export interface EditSeen {
    version?: number;
    base: unknown;
}

const isEmpty = (v: unknown) =>
    v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

// ---------------------------------------------------------------------------
// Dates: the grid shows dd/mm/yyyy, the API value is yyyy-mm-dd.
// ---------------------------------------------------------------------------

export const isoToDisplay = (iso: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const pad = (n: number) => String(n).padStart(2, '0');

export const toIsoDate = (year: number, month: number, day: number): string | null => {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
};

/**
 * Keyboard-friendly date entry: `1/2/2026`, `01-02-26`, `01.02`, `01022026`, `010226`, `0102`
 * (missing year = current year; two-digit year = 20yy). Returns yyyy-mm-dd or null.
 */
export const parseDateInput = (text: string, today: Date = new Date()): string | null => {
    const t = text.trim();
    let day: number, month: number, year: number;
    const sep = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$/.exec(t);
    if (sep) {
        day = Number(sep[1]);
        month = Number(sep[2]);
        year = sep[3] ? Number(sep[3]) : today.getFullYear();
    } else if (/^\d{4}$|^\d{6}$|^\d{8}$/.test(t)) {
        day = Number(t.slice(0, 2));
        month = Number(t.slice(2, 4));
        year = t.length > 4 ? Number(t.slice(4)) : today.getFullYear();
    } else {
        return null;
    }
    if (year < 100) year += 2000;
    return toIsoDate(year, month, day);
};

/** Moves an ISO date by whole days (used by the date editor's arrow keys). */
export const shiftIsoDate = (iso: string, days: number): string => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const next = new Date(Date.UTC(y, m - 1, d + days));
    return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

// ---------------------------------------------------------------------------
// Cell text <-> value
// ---------------------------------------------------------------------------

const optionList = (col: GridColumnDef, options: GridOptions): Option[] => options[col.optionsKey ?? ''] ?? [];

/** Text shown in a cell (ids become option names, dates become dd/mm/yyyy). */
export const cellText = (col: GridColumnDef, value: unknown, options: GridOptions): string => {
    if (value === null || value === undefined) return '';
    if (col.kind === 'multi') {
        const list = optionList(col, options);
        return (value as number[]).map((id) => list.find((o) => o.id === id)?.name ?? `#${id}`).join(', ');
    }
    if (col.kind === 'select') return optionList(col, options).find((o) => o.id === value)?.name ?? `#${String(value)}`;
    if (col.kind === 'date') return isoToDisplay(String(value));
    return String(value);
};

const parseDecimal = (text: string): number | null => {
    // "1.234,56" (es-AR) or "1234.56": a comma is the decimal separator and dots are thousands.
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
    return Number(normalized);
};

/** Parses what the user typed or pasted into the API value for the column. */
export const parseCellInput = (
    col: GridColumnDef,
    text: string,
    options: GridOptions
): { value: unknown } | { error: string } => {
    const trimmed = text.trim();
    if (col.kind === 'multi') {
        if (trimmed === '') return col.required ? { error: 'Elegí al menos una opción' } : { value: [] };
        const list = optionList(col, options);
        const names = trimmed.split(',').map((n) => n.trim()).filter(Boolean);
        const unknown = names.filter((n) => !list.some((o) => o.name.toLowerCase() === n.toLowerCase()));
        if (unknown.length) return { error: `No existe: ${unknown.join(', ')}` };
        const picked = names.map((n) => list.find((o) => o.name.toLowerCase() === n.toLowerCase())!.id);
        return { value: [...new Set(picked)].sort((a, b) => a - b) };
    }
    if (col.kind === 'select') {
        if (trimmed === '') return col.required ? { error: col.requiredMessage ?? 'Elegí una opción' } : { value: null };
        const matches = optionList(col, options).filter((o) => o.name.toLowerCase() === trimmed.toLowerCase());
        if (matches.length === 0) return { error: `No existe: ${trimmed}` };
        if (matches.length > 1) return { error: `Hay más de una opción llamada "${trimmed}": elegila con el selector` };
        return { value: matches[0]!.id };
    }
    if (col.kind === 'date') {
        if (trimmed === '') return col.required ? { error: col.requiredMessage ?? 'La fecha es obligatoria' } : { value: null };
        const iso = parseDateInput(trimmed);
        return iso ? { value: iso } : { error: 'Fecha inválida (usá dd/mm/aaaa)' };
    }
    if (col.kind === 'number') {
        if (trimmed === '') return col.required ? { error: col.requiredMessage ?? 'Campo obligatorio' } : { value: null };
        if (col.decimals) {
            const n = parseDecimal(trimmed);
            return n === null ? { error: 'Tiene que ser un número' } : { value: n };
        }
        if (!/^\d+$/.test(trimmed)) return { error: 'Tiene que ser un número entero' };
        return { value: Number(trimmed) };
    }
    if (col.kind === 'enum') {
        if (trimmed === '') return { value: null };
        const match = col.values!.find((v) => v.toLowerCase() === trimmed.toLowerCase());
        return match ? { value: match } : { error: `Usá ${col.values!.join(' o ')}` };
    }
    if (trimmed === '') return col.required ? { error: col.requiredMessage ?? 'Campo obligatorio' } : { value: null };
    return { value: trimmed };
};

export const missingRequired = <F extends string>(columns: GridColumnDef<F>[], values: RowValues<F>): F[] =>
    columns.filter((c) => c.required && isEmpty(values[c.field])).map((c) => c.field);

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

/**
 * Splits clipboard text (TSV from Excel/Sheets) into rows and cells. A single trailing
 * line break (Excel adds one when copying) does not make an extra row.
 */
export const parseClipboardBlock = (text: string): string[][] => {
    const lines = text.split(/\r\n|\n|\r/);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines.map((line) => line.split('\t'));
};

/** True when the text is a block (several cells or rows), not a single value. */
export const isBlockClipboard = (text: string): boolean => {
    const block = parseClipboardBlock(text);
    return block.length > 1 || (block[0]?.length ?? 0) > 1;
};

export interface BatchRow<F extends string = string> {
    id?: number;
    version?: number;
    values: RowValues<F>;
    base?: RowValues<F>;
}

export interface PastePlan<F extends string = string> {
    /** One entry per pasted row that produced something to send, with its grid row key (or null for a new row). */
    rows: { key: string | null; batch: BatchRow<F> }[];
    /** Cells that could not be parsed, by row key (new rows use `new:<i>` with i = pasted row index). */
    localErrors: Record<string, Partial<Record<F, string>>>;
    /** Values of new rows, parsed cells only, to keep as drafts if the server rejects them. */
    newRowValues: Record<string, RowValues<F>>;
}

/**
 * Maps a pasted block (Excel/Sheets) at [col, row] onto existing rows
 * (updates) and new rows past the end (creates).
 */
export const planPaste = <F extends string>(
    target: { col: number; row: number },
    block: readonly (readonly string[])[],
    rows: GridRow<F>[],
    options: GridOptions,
    columns: GridColumnDef<F>[]
): PastePlan<F> => {
    const plan: PastePlan<F> = { rows: [], localErrors: {}, newRowValues: {} };
    block.forEach((cells, i) => {
        const rowIndex = target.row + i;
        const existing = rows[rowIndex];
        const isDraft = existing && existing.id === undefined;
        const key = existing ? existing.key : `new:${i}`;
        const values: RowValues<F> = {};
        const base: RowValues<F> = {};
        cells.forEach((text, j) => {
            const col = columns[target.col + j];
            if (!col || col.readOnly) return;
            const parsed = parseCellInput(col, text ?? '', options);
            if ('error' in parsed) {
                (plan.localErrors[key] ??= {})[col.field] = parsed.error;
                return;
            }
            values[col.field] = parsed.value;
            if (existing) base[col.field] = existing.values[col.field] ?? null;
        });
        if (!existing || isDraft) {
            const merged = { ...(existing?.values ?? {}), ...values };
            plan.newRowValues[key] = merged;
            if (Object.keys(merged).length && !plan.localErrors[key]) plan.rows.push({ key: existing ? key : null, batch: { values: merged } });
            return;
        }
        if (Object.keys(values).length) {
            plan.rows.push({ key, batch: { id: existing.id, version: existing.version, values, base } });
        }
    });
    return plan;
};

/** Column title without the required-field asterisk. */
export const plainTitle = (col: { title: string }): string => col.title.replace(' *', '');
