import { useContext } from 'react';
import { isoToDisplay, parseDateInput, shiftIsoDate, toIsoDate } from '../../model/gridModel.js';
import { useEditorFocus } from '../hooks/useEditorFocus.js';
import { GridEditorContext } from './GridEditorContext.js';
import { INPUT_STYLE, textOf, withText, type EditorProps } from './editorTypes.js';

const today = () => {
    const t = new Date();
    return toIsoDate(t.getFullYear(), t.getMonth() + 1, t.getDate())!;
};

/**
 * Date entry by keyboard: type `1/2/26`, `01022026` or `0102` (see `parseDateInput`),
 * ArrowUp / ArrowDown move the date by a day. The text is parsed when the cell is
 * confirmed, so an invalid date is flagged on the cell like any other error.
 */
export function DateEditor({ value, initialValue, onChange }: EditorProps) {
    const inputRef = useEditorFocus(initialValue);
    const { labels } = useContext(GridEditorContext);
    return (
        <input
            ref={inputRef}
            className="gdg-input"
            style={INPUT_STYLE}
            type="text"
            inputMode="numeric"
            placeholder={labels.datePlaceholder}
            aria-label={labels.dateLabel}
            value={textOf(value)}
            onChange={(e) => onChange(withText(value, e.target.value))}
            onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                e.preventDefault();
                e.stopPropagation();
                const iso = parseDateInput(e.currentTarget.value) ?? today();
                onChange(withText(value, isoToDisplay(shiftIsoDate(iso, e.key === 'ArrowUp' ? 1 : -1))));
            }}
        />
    );
}
