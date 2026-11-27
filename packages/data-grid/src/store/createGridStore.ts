import { create } from 'zustand';
import {
    missingRequired, planPaste, plainTitle,
    type BatchRow, type EditSeen, type GridColumnDef, type GridOptions, type GridRow, type RowValues,
} from '../model/gridModel.js';
import {
    isGridConflict, type ApiRowBase, type BatchResult, type CellErrors, type GridMessages, type GridNotify,
    type GridRealtime, type GridRealtimeEvent, type GridTransport, type PresenceCursor, type PresenceMember,
} from './types.js';

/**
 * Store factory for a collaborative grid. Every confirmed cell is saved at once
 * (`transport.patch` with version + base); a paste is one `transport.batch`.
 * Changes from other users arrive through `realtime` and never touch the cell a
 * user is editing: the grid's overlay editor holds its own value, and a stale
 * save comes back as a `GridConflictError` with the current row.
 *
 * Nothing here knows about HTTP, WebSockets, toasts or env vars: the app passes
 * them in as adapters.
 */

export interface GridStoreConfig<A extends ApiRowBase, F extends string> {
    columns: GridColumnDef<F>[];
    emptyOptions: GridOptions;
    rowFromApi: (row: A) => GridRow<F>;
    transport: GridTransport<A, F>;
    /** Optional live updates and presence; without it the grid works single-user. */
    realtime?: GridRealtime<A>;
    /** Optional user feedback (toasts); without it messages are dropped. */
    notify?: GridNotify;
    /** Text shown for a failed write or load (default: the error's message). */
    errorMessage?: (error: unknown) => string;
    /** Stable order for loaded rows. */
    sortRows?: (a: GridRow<F>, b: GridRow<F>) => number;
    /** A remote row that must leave the grid (e.g. soft-deleted by someone else). */
    isRemoved?: (row: A) => boolean;
    /** A remote row not in the grid yet: false = it does not belong to this sheet. */
    acceptRemote?: (row: A) => boolean;
    /** Override any user-facing text (defaults are Spanish, as in the source app). */
    messages?: Partial<GridMessages>;
}

export type GridConnection = 'none' | 'connecting' | 'open' | 'closed';

export interface GridStoreState<A extends ApiRowBase, F extends string> {
    scopeId: number | null;
    rows: GridRow<F>[];
    options: GridOptions;
    cellErrors: CellErrors<F>;
    /** Cells saved by me that the server has not confirmed yet, by row key. */
    pending: Record<string, Partial<Record<F, unknown>>>;
    savingCount: number;
    members: PresenceMember[];
    connId: string | null;
    /** `none` = no realtime adapter. */
    connection: GridConnection;
    loading: boolean;
    error: string | null;
    /** Informational message from the last load (e.g. the row cap was reached). */
    notice: string | null;

    load: (scopeId: number) => Promise<void>;
    connect: (scopeId: number) => void;
    disconnect: () => void;
    sendCursor: (cursor: PresenceCursor | null) => void;
    editCell: (rowKey: string, field: F, value: unknown, seen: EditSeen, opts?: { fromUndo?: boolean }) => Promise<void>;
    setCellError: (rowKey: string, field: F, message: string | null) => void;
    addDraftRow: () => string;
    paste: (target: { col: number; row: number }, block: readonly (readonly string[])[]) => Promise<void>;
    deleteRows: (rowKeys: readonly string[]) => Promise<void>;
    undo: () => Promise<void>;
    applyRemoteRows: (rows: A[]) => void;
    /** Rows that left what this user may see: dropped without notice. */
    applyRemoteRemovals: (ids: number[]) => void;
    reset: () => void;
}

const show = (v: unknown, multi: boolean, list: string, empty: string) =>
    Array.isArray(v) || multi ? list : v === null || v === undefined || v === '' ? empty : `"${String(v)}"`;

export const DEFAULT_GRID_MESSAGES: GridMessages = {
    conflict: ({ column, theirs, mine }) => `${column}: otro usuario lo cambió a ${theirs} mientras editabas. No se guardó ${mine}.`,
    conflictCell: 'Conflicto: otro usuario cambió este valor',
    listValue: '(lista)',
    emptyValue: '(vacío)',
    pasted: ({ created, updated, failed }) => {
        const parts = [`${created} creados`, `${updated} actualizados`];
        if (failed) parts.push(`${failed} con errores (marcados en rojo)`);
        return `Pegado: ${parts.join(', ')}`;
    },
    deleted: (count) => (count === 1 ? 'Fila eliminada' : `${count} filas eliminadas`),
};

const defaultErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Error';

const withoutKey = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
    const { [key]: _drop, ...rest } = record;
    return rest;
};

export function createGridStore<A extends ApiRowBase, F extends string>(config: GridStoreConfig<A, F>) {
    interface UndoEntry { rowKey: string; field: F; before: unknown; after: unknown }

    const { transport, realtime, notify } = config;
    const messages: GridMessages = { ...DEFAULT_GRID_MESSAGES, ...config.messages };
    const errorText = config.errorMessage ?? defaultErrorMessage;
    const toast = (text: string, tone: 'success' | 'error' | 'warning') => {
        if (!notify) return;
        if (tone === 'success') notify.success(text);
        else if (tone === 'warning') (notify.warning ?? notify.error)(text);
        else notify.error(text);
    };
    const idleConnection: GridConnection = realtime ? 'closed' : 'none';

    // Per-store session state (one store = one open sheet at a time).
    let unsubscribe: (() => void) | null = null;
    let draftSeq = 0;
    let undoStack: UndoEntry[] = [];
    let creating = new Set<string>();
    let cursorTimer: ReturnType<typeof setTimeout> | undefined;
    let lastCursor: PresenceCursor | null = null;
    let hasConnectedOnce = false;

    const columnOf = (field: F) => config.columns.find((c) => c.field === field)!;

    return create<GridStoreState<A, F>>((set, get) => {
        /** Replaces a confirmed row, keeping my unconfirmed cells on top of it. */
        const mergeServerRow = (incoming: A) => {
            const next = config.rowFromApi(incoming);
            const mine = get().pending[next.key];
            if (mine) next.values = { ...next.values, ...mine };
            return next;
        };

        const clearPending = (rowKey: string, field: F) =>
            set((s) => {
                const row: Partial<Record<F, unknown>> = { ...s.pending[rowKey] };
                delete row[field];
                return { pending: Object.keys(row).length ? { ...s.pending, [rowKey]: row } : withoutKey(s.pending, rowKey) };
            });

        const setCellError = (rowKey: string, field: F, message: string | null) =>
            set((s) => {
                const row: Partial<Record<F, string>> = { ...s.cellErrors[rowKey] };
                if (message) row[field] = message;
                else delete row[field];
                return { cellErrors: Object.keys(row).length ? { ...s.cellErrors, [rowKey]: row } : withoutKey(s.cellErrors, rowKey) };
            });

        const replaceRow = (rowKey: string, row: GridRow<F>) =>
            set((s) => ({ rows: s.rows.map((r) => (r.key === rowKey ? row : r)) }));

        /** keys[i] is the grid row key of request row i (a draft or existing key), or null for a brand-new row. */
        const applyBatchResults = (results: BatchResult<A>[], keys: (string | null)[], newRowValues: Record<string, RowValues<F>> = {}) => {
            const appended: GridRow<F>[] = [];
            for (const result of results) {
                const key = keys[result.index];
                if (result.status === 'created' || result.status === 'updated') {
                    const row = config.rowFromApi(result.row);
                    const already = get().rows.some((r) => r.key === row.key);
                    if (key && key.startsWith('draft:')) {
                        set((s) => ({ rows: already ? s.rows.filter((r) => r.key !== key) : s.rows.map((r) => (r.key === key ? row : r)), cellErrors: withoutKey(s.cellErrors, key) }));
                    } else if (key) {
                        replaceRow(key, mergeServerRow(result.row));
                        set((s) => ({ cellErrors: withoutKey(s.cellErrors, key) }));
                    } else if (!already) {
                        appended.push(row);
                    }
                    continue;
                }
                const errors = (('errors' in result ? result.errors : undefined) ?? {}) as Partial<Record<F, string>>;
                if (result.status === 'conflict' && key) replaceRow(key, mergeServerRow(result.current));
                if (key) {
                    set((s) => ({ cellErrors: { ...s.cellErrors, [key]: { ...(s.cellErrors[key] ?? {}), ...errors } } }));
                } else {
                    const draftKey = `draft:${++draftSeq}`;
                    const values = newRowValues[`new:${result.index}`] ?? {};
                    appended.push({ key: draftKey, values });
                    set((s) => ({ cellErrors: { ...s.cellErrors, [draftKey]: errors } }));
                }
            }
            if (appended.length) set((s) => ({ rows: [...s.rows, ...appended] }));
        };

        const createDraft = async (rowKey: string) => {
            const { scopeId, rows } = get();
            const draft = rows.find((r) => r.key === rowKey);
            if (!draft || scopeId === null || creating.has(rowKey) || missingRequired(config.columns, draft.values).length) return;
            creating.add(rowKey);
            set((s) => ({ savingCount: s.savingCount + 1 }));
            try {
                const res = await transport.batch(scopeId, [{ values: draft.values }]);
                applyBatchResults(res.results ?? [], [rowKey]);
            } catch (error) {
                toast(errorText(error), 'error');
            } finally {
                creating.delete(rowKey);
                set((s) => ({ savingCount: s.savingCount - 1 }));
            }
        };

        const onRealtime = (scopeId: number) => (event: GridRealtimeEvent<A>) => {
            switch (event.type) {
                case 'status':
                    set({ connection: event.status });
                    if (event.status === 'open') {
                        // After a reconnect, reload to pick up changes missed while offline.
                        if (hasConnectedOnce) void get().load(scopeId);
                        hasConnectedOnce = true;
                        if (lastCursor) realtime?.sendCursor?.(lastCursor);
                    }
                    break;
                case 'presence':
                    set(event.connId !== undefined ? { members: event.members, connId: event.connId } : { members: event.members });
                    break;
                case 'rows':
                    get().applyRemoteRows(event.rows);
                    break;
                case 'removed':
                    get().applyRemoteRemovals(event.ids);
                    break;
                case 'error':
                    toast(event.message, 'error');
                    break;
            }
        };

        return {
            scopeId: null,
            rows: [],
            options: config.emptyOptions,
            cellErrors: {},
            pending: {},
            savingCount: 0,
            members: [],
            connId: null,
            connection: idleConnection,
            loading: false,
            error: null,
            notice: null,

            load: async (scopeId) => {
                set({ loading: true, error: null, scopeId });
                try {
                    const { rows, options, notice } = await transport.fetchAll(scopeId);
                    const mapped = rows.map(config.rowFromApi);
                    set({
                        rows: config.sortRows ? mapped.sort(config.sortRows) : mapped,
                        options,
                        cellErrors: {},
                        pending: {},
                        notice: notice ?? null,
                        loading: false,
                    });
                } catch (error) {
                    set({ error: errorText(error), loading: false });
                }
            },

            connect: (scopeId) => {
                if (!realtime) return;
                unsubscribe?.();
                hasConnectedOnce = false;
                set({ connection: 'connecting' });
                unsubscribe = realtime.subscribe(scopeId, onRealtime(scopeId));
            },

            disconnect: () => {
                unsubscribe?.();
                unsubscribe = null;
                set({ members: [], connId: null, connection: idleConnection });
            },

            sendCursor: (cursor) => {
                lastCursor = cursor;
                if (!realtime?.sendCursor) return;
                clearTimeout(cursorTimer);
                cursorTimer = setTimeout(() => realtime.sendCursor?.(lastCursor), 60);
            },

            applyRemoteRows: (incoming) => {
                set((s) => {
                    const rows = [...s.rows];
                    for (const p of incoming) {
                        const i = rows.findIndex((r) => r.id === p.id);
                        if (config.isRemoved?.(p)) {
                            if (i !== -1) rows.splice(i, 1);
                            continue;
                        }
                        if (i === -1) {
                            if (config.acceptRemote && !config.acceptRemote(p)) continue;
                            rows.push(mergeServerRow(p));
                            continue;
                        }
                        const local = rows[i]!;
                        if ((local.version ?? 0) >= p.version) continue;
                        rows[i] = mergeServerRow(p);
                    }
                    return { rows };
                });
            },

            applyRemoteRemovals: (ids) => {
                const gone = new Set(ids);
                const keys = new Set(get().rows.filter((r) => r.id !== undefined && gone.has(r.id)).map((r) => r.key));
                if (keys.size === 0) return;
                set((s) => ({
                    rows: s.rows.filter((r) => !keys.has(r.key)),
                    cellErrors: Object.fromEntries(Object.entries(s.cellErrors).filter(([k]) => !keys.has(k))),
                    pending: Object.fromEntries(Object.entries(s.pending).filter(([k]) => !keys.has(k))),
                }));
                undoStack = undoStack.filter((u) => !keys.has(u.rowKey));
            },

            setCellError,

            editCell: async (rowKey, field, value, seen, opts = {}) => {
                const row = get().rows.find((r) => r.key === rowKey);
                if (!row) return;
                const before = seen.base;
                setCellError(rowKey, field, null);

                if (row.id === undefined) {
                    replaceRow(rowKey, { ...row, values: { ...row.values, [field]: value } });
                    const missing = missingRequired(config.columns, { ...row.values, [field]: value });
                    if (missing.length === 0) await createDraft(rowKey);
                    return;
                }

                if (!opts.fromUndo) undoStack.push({ rowKey, field, before, after: value });
                set((s) => ({
                    rows: s.rows.map((r) => (r.key === rowKey ? { ...r, values: { ...r.values, [field]: value } } : r)),
                    pending: { ...s.pending, [rowKey]: { ...(s.pending[rowKey] ?? {}), [field]: value } },
                    savingCount: s.savingCount + 1,
                }));
                try {
                    const saved = await transport.patch({
                        id: row.id, field, value, version: seen.version ?? row.version, base: seen.base ?? null,
                    });
                    clearPending(rowKey, field);
                    const local = get().rows.find((r) => r.key === rowKey);
                    if (saved && (!local?.version || saved.version >= local.version)) replaceRow(rowKey, mergeServerRow(saved));
                } catch (error) {
                    clearPending(rowKey, field);
                    if (isGridConflict<A>(error)) {
                        const current = error.current;
                        if (current) replaceRow(rowKey, mergeServerRow(current));
                        const col = columnOf(field);
                        const now = current ? config.rowFromApi(current).values[field] : undefined;
                        const multi = col.kind === 'multi';
                        toast(messages.conflict({
                            column: plainTitle(col),
                            theirs: show(now, multi, messages.listValue, messages.emptyValue),
                            mine: show(value, multi, messages.listValue, messages.emptyValue),
                        }), 'warning');
                        setCellError(rowKey, field, messages.conflictCell);
                        undoStack = undoStack.filter((u) => !(u.rowKey === rowKey && u.field === field));
                        return;
                    }
                    const stillThere = get().rows.find((r) => r.key === rowKey);
                    // The row left this user's scope while the save was in flight: nothing to revert or report.
                    if (!stillThere) return;
                    replaceRow(rowKey, { ...stillThere, values: { ...row.values, [field]: before } });
                    setCellError(rowKey, field, errorText(error));
                    toast(errorText(error), 'error');
                } finally {
                    set((s) => ({ savingCount: s.savingCount - 1 }));
                }
            },

            addDraftRow: () => {
                const key = `draft:${++draftSeq}`;
                set((s) => ({ rows: [...s.rows, { key, values: {} }] }));
                return key;
            },

            paste: async (target, block) => {
                const { rows, options, scopeId } = get();
                if (scopeId === null) return;
                const plan = planPaste(target, block, rows, options, config.columns);
                for (const [key, errors] of Object.entries(plan.localErrors)) {
                    if (key.startsWith('new:')) {
                        const draftKey = `draft:${++draftSeq}`;
                        set((s) => ({ rows: [...s.rows, { key: draftKey, values: plan.newRowValues[key] ?? {} }], cellErrors: { ...s.cellErrors, [draftKey]: errors } }));
                    } else {
                        set((s) => ({ cellErrors: { ...s.cellErrors, [key]: { ...(s.cellErrors[key] ?? {}), ...errors } } }));
                    }
                }
                if (plan.rows.length === 0) return;
                const keys = plan.rows.map((r) => r.key);
                const newValuesByIndex: Record<string, RowValues<F>> = {};
                plan.rows.forEach((r, i) => {
                    if (r.key === null) newValuesByIndex[`new:${i}`] = r.batch.values;
                });
                set((s) => ({ savingCount: s.savingCount + 1 }));
                try {
                    const data = await transport.batch(scopeId, plan.rows.map((r) => r.batch));
                    const results = data.results ?? [];
                    applyBatchResults(results, keys, newValuesByIndex);
                    const created = data.created ?? results.filter((r) => r.status === 'created').length;
                    const updated = data.updated ?? results.filter((r) => r.status === 'updated').length;
                    const serverFailed = data.failed ?? results.filter((r) => r.status === 'error' || r.status === 'conflict').length;
                    const failed = serverFailed + Object.keys(plan.localErrors).length;
                    toast(messages.pasted({ created, updated, failed }), failed ? 'warning' : 'success');
                } catch (error) {
                    toast(errorText(error), 'error');
                } finally {
                    set((s) => ({ savingCount: s.savingCount - 1 }));
                }
            },

            deleteRows: async (rowKeys) => {
                const wanted = new Set(rowKeys);
                const targets = get().rows.filter((r) => wanted.has(r.key));
                if (targets.length === 0) return;
                const drop = (keys: string[]) => set((s) => {
                    const gone = new Set(keys);
                    return {
                        rows: s.rows.filter((r) => !gone.has(r.key)),
                        cellErrors: Object.fromEntries(Object.entries(s.cellErrors).filter(([k]) => !gone.has(k))),
                        pending: Object.fromEntries(Object.entries(s.pending).filter(([k]) => !gone.has(k))),
                    };
                });
                // A draft was never saved: it just disappears.
                drop(targets.filter((r) => r.id === undefined).map((r) => r.key));
                const saved = targets.filter((r) => r.id !== undefined);
                if (saved.length === 0 || !transport.delete) return;
                set((s) => ({ savingCount: s.savingCount + 1 }));
                try {
                    try {
                        await transport.delete(saved.map((r) => r.id!));
                    } catch (error) {
                        toast(errorText(error), 'error');
                        return;
                    }
                    const okKeys = saved.map((r) => r.key);
                    drop(okKeys);
                    undoStack = undoStack.filter((u) => !okKeys.includes(u.rowKey));
                    toast(messages.deleted(okKeys.length), 'success');
                } finally {
                    set((s) => ({ savingCount: s.savingCount - 1 }));
                }
            },

            undo: async () => {
                const entry = undoStack.pop();
                if (!entry) return;
                const row = get().rows.find((r) => r.key === entry.rowKey);
                if (!row) return;
                await get().editCell(entry.rowKey, entry.field, entry.before, { version: row.version, base: entry.after }, { fromUndo: true });
            },

            reset: () => {
                unsubscribe?.();
                unsubscribe = null;
                clearTimeout(cursorTimer);
                undoStack = [];
                creating = new Set();
                lastCursor = null;
                set({
                    scopeId: null, rows: [], options: config.emptyOptions, cellErrors: {}, pending: {}, savingCount: 0,
                    members: [], connId: null, connection: idleConnection, loading: false, error: null, notice: null,
                });
            },
        };
    });
}

export type GridStore<A extends ApiRowBase, F extends string> = ReturnType<typeof createGridStore<A, F>>;

export const nameForUser = (members: PresenceMember[], userId: number): string | undefined =>
    members.find((m) => m.userId === userId)?.name;

/** Active options of a list payload (`{ data: [...] }` or a bare array), as `{ id, name }`. */
export const optionList = (payload: unknown): { id: number; name: string }[] => {
    const raw = (payload as { data?: unknown })?.data ?? payload;
    return (Array.isArray(raw) ? raw : [])
        .filter((o: { active?: boolean }) => o.active !== false)
        .map((o: { id: number; name: string }) => ({ id: o.id, name: o.name }));
};
