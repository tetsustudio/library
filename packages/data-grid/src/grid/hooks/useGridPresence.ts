import { useMemo } from 'react';
import type { Highlight } from '@glideapps/glide-data-grid';
import type { GridColumnDef, GridRow } from '../../model/gridModel.js';
import type { PresenceMember } from '../../store/types.js';

/** Other users' cursors as grid highlights (solid while they edit, dashed otherwise) and the avatar list. */
export function useGridPresence(members: PresenceMember[], connId: string | null, rows: GridRow[], columns: GridColumnDef[]) {
    const highlights = useMemo<Highlight[]>(() => members
        .filter((m) => m.connId !== connId && m.cursor && m.cursor.rowId !== null)
        .flatMap((m) => {
            const y = rows.findIndex((r) => r.id === m.cursor!.rowId);
            const x = columns.findIndex((c) => c.field === m.cursor!.col);
            if (y === -1 || x === -1) return [];
            const width = Math.max(1, m.cursor!.range?.width ?? 1);
            const height = Math.max(1, m.cursor!.range?.height ?? 1);
            return [{
                color: `${m.color}${m.cursor!.editing ? '55' : '22'}`,
                range: { x, y, width, height },
                style: m.cursor!.editing ? 'solid' : 'dashed',
            } satisfies Highlight];
        }), [members, connId, rows, columns]);

    const others = useMemo(() => {
        const byUser = new Map<number, { userId: number; name: string; color: string; editing: boolean }>();
        for (const m of members) {
            if (m.connId === connId) continue;
            const prev = byUser.get(m.userId);
            byUser.set(m.userId, { userId: m.userId, name: m.name, color: m.color, editing: (prev?.editing ?? false) || !!m.cursor?.editing });
        }
        return [...byUser.values()];
    }, [members, connId]);

    return { highlights, others };
}
