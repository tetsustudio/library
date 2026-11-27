import { useEffect } from 'react';

/**
 * While `active`, Enter runs `onConfirm` once (capture phase, so it wins over a focused
 * "Cancelar" button) instead of whatever the focused element would do.
 */
export function useConfirmEnter(active: boolean, onConfirm: () => void) {
    useEffect(() => {
        if (!active) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || e.repeat) return;
            e.preventDefault();
            e.stopPropagation();
            onConfirm();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [active, onConfirm]);
}
