import { useCallback, useMemo, useState } from 'react';

/**
 * Two-step row deletion for the grid: `request(keys)` parks the keys, `confirm` hands them
 * to `onDelete` and `cancel` drops them. Either way `onClosed` runs so focus can return to the grid.
 */
export function useDeleteConfirmation(onDelete: ((rowKeys: string[]) => void) | undefined, onClosed: () => void) {
    const [pending, setPending] = useState<string[] | null>(null);

    const request = useCallback((keys: string[]) => {
        if (onDelete && keys.length) setPending(keys);
    }, [onDelete]);

    const close = useCallback(() => {
        setPending(null);
        // The modal unmounts first; give the browser a tick to hand focus back.
        setTimeout(onClosed, 0);
    }, [onClosed]);

    const confirm = useCallback(() => {
        if (pending && onDelete) onDelete(pending);
        close();
    }, [pending, onDelete, close]);

    return useMemo(
        () => ({ request, confirm, cancel: close, pendingCount: pending ? pending.length : null }),
        [request, confirm, close, pending]
    );
}
