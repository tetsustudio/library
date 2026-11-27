import type { BatchRow, GridOptions } from '../model/gridModel.js';

/** A server row: the store needs its id and an optimistic-concurrency version. */
export interface ApiRowBase { id: number; version: number }

export type CellErrors<F extends string> = Record<string, Partial<Record<F, string>>>;

/** Result of one row of a batch request, in request order (`index`). */
export type BatchResult<A> =
    | { index: number; status: 'created' | 'updated'; row: A }
    | { index: number; status: 'error'; errors?: Record<string, string> }
    | { index: number; status: 'conflict'; current: A; errors?: Record<string, string> };

export interface PatchRequest<F extends string> {
    id: number;
    field: F;
    value: unknown;
    /** Version of the row the user saw. */
    version: number | undefined;
    /** Value of the cell the user saw (for a field-level merge on the server). */
    base: unknown;
}

/**
 * How the store talks to your backend. Every function is async and throws on
 * failure; the thrown error's text reaches the user through `errorMessage`.
 */
export interface GridTransport<A extends ApiRowBase, F extends string> {
    /** Every row of the scope plus the option lists the columns need. */
    fetchAll: (scopeId: number) => Promise<{ rows: A[]; options: GridOptions; notice?: string | null }>;
    /** Saves one cell. Throw `GridConflictError(current)` when the version is stale. */
    patch: (request: PatchRequest<F>) => Promise<A | undefined | void>;
    /** Creates and updates many rows (a paste, a new row). Counts are derived from `results` when missing. */
    batch: (scopeId: number, rows: BatchRow<F>[]) => Promise<{ results: BatchResult<A>[]; created?: number; updated?: number; failed?: number }>;
    /** Present = rows can be deleted. */
    delete?: (ids: number[]) => Promise<unknown>;
}

export interface PresenceCursor {
    rowId: number | null;
    col: string;
    range?: { x: number; y: number; width: number; height: number };
    editing: boolean;
}

export interface PresenceMember {
    connId: string;
    userId: number;
    name: string;
    color: string;
    cursor: PresenceCursor | null;
}

/** What a realtime adapter emits into the store. */
export type GridRealtimeEvent<A> =
    | { type: 'status'; status: 'connecting' | 'open' | 'closed' }
    | { type: 'rows'; rows: A[] }
    | { type: 'removed'; ids: number[] }
    | { type: 'presence'; members: PresenceMember[]; connId?: string | null }
    | { type: 'error'; message: string };

/**
 * Live updates. `subscribe` joins the scope and returns the unsubscribe function.
 * Emit `{ type: 'status', status: 'open' }` on every (re)connect: after the first
 * one the store reloads to catch up on what it missed.
 */
export interface GridRealtime<A> {
    subscribe: (scopeId: number, emit: (event: GridRealtimeEvent<A>) => void) => () => void;
    /** Broadcast my cursor (debounced by the store; re-sent after a reconnect). */
    sendCursor?: (cursor: PresenceCursor | null) => void;
}

/** User feedback, usually your toast system. `warning` falls back to `error`. */
export interface GridNotify {
    success: (message: string) => void;
    error: (message: string) => void;
    warning?: (message: string) => void;
}

export interface GridMessages {
    conflict: (p: { column: string; theirs: string; mine: string }) => string;
    conflictCell: string;
    listValue: string;
    emptyValue: string;
    pasted: (p: { created: number; updated: number; failed: number }) => string;
    deleted: (count: number) => string;
}

/** Throw it from `transport.patch` when the row changed since the user saw it. */
export class GridConflictError<A = unknown> extends Error {
    readonly current: A | undefined;
    constructor(current?: A, message = 'Version conflict') {
        super(message);
        this.name = 'GridConflictError';
        this.current = current;
    }
}

/** True for a `GridConflictError`, even one from another copy of this package. */
export const isGridConflict = <A>(error: unknown): error is GridConflictError<A> =>
    error instanceof GridConflictError || (error instanceof Error && error.name === 'GridConflictError' && 'current' in error);
