'use client';
import { useEffect, useRef } from 'react';
import { useConfirmEnter } from './hooks/useConfirmEnter.js';
import type { GridLabels } from './labels.js';

interface DeleteRowsConfirmProps {
    /** Rows waiting for confirmation; null = closed. */
    count: number | null;
    onConfirm: () => void;
    onCancel: () => void;
    labels: Pick<GridLabels, 'deleteTitle' | 'deleteMessage' | 'deleteConfirm' | 'cancel'>;
}

/** "Delete N rows?" dialog of the grid. Enter confirms, Esc cancels. */
export function DeleteRowsConfirm({ count, onConfirm, onCancel, labels }: DeleteRowsConfirmProps) {
    useConfirmEnter(count !== null, onConfirm);
    const cancelRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (count === null) return;
        cancelRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [count, onCancel]);
    if (count === null) return null;
    return (
        <div className="tds-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
            <div className="tds-modal__panel" role="alertdialog" aria-modal="true" aria-labelledby="tds-delete-title">
                <h2 id="tds-delete-title" className="tds-modal__title">{labels.deleteTitle}</h2>
                <p className="tds-modal__message">{labels.deleteMessage(count)}</p>
                <div className="tds-modal__actions">
                    <button ref={cancelRef} type="button" className="tds-button" onClick={onCancel}>{labels.cancel}</button>
                    <button type="button" className="tds-button tds-button--danger" onClick={onConfirm}>{labels.deleteConfirm}</button>
                </div>
            </div>
        </div>
    );
}
