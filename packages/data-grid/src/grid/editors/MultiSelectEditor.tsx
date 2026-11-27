import { useContext, useMemo, useRef, useState } from 'react';
import type { GridColumnDef } from '../../model/gridModel.js';
import { useEditorFocus, useScrollActiveIntoView } from '../hooks/useEditorFocus.js';
import { GridEditorContext } from './GridEditorContext.js';
import { NO_OPTIONS, filterOptions } from './SelectEditor.js';
import {
    HINT_STYLE, INPUT_STYLE, LIST_STYLE, ROOT_STYLE, optionStyle, withText,
    type EditorProps, type SeenCell,
} from './editorTypes.js';

/**
 * Multiselect: type to filter, ArrowUp/Down to move, Enter ticks / unticks the highlighted
 * option, Tab accepts and moves right, Ctrl+Enter accepts and moves down, Esc cancels.
 * Starts from the cell's real value even when opened by typing.
 */
export const makeMultiSelectEditor = (col: GridColumnDef) => {
    function MultiSelectEditor({ value, initialValue, onChange }: EditorProps) {
        const { options, labels } = useContext(GridEditorContext);
        const list = options[col.optionsKey ?? ''] ?? NO_OPTIONS;
        const [selected, setSelected] = useState<number[]>(() => {
            const base = (value as SeenCell).__seen?.base;
            return Array.isArray(base) ? (base as number[]) : [];
        });
        const [query, setQuery] = useState(initialValue ?? '');
        const [active, setActive] = useState(0);
        const matches = useMemo(() => filterOptions(list, query), [list, query]);
        const inputRef = useEditorFocus(initialValue);
        const listRef = useRef<HTMLUListElement>(null);
        useScrollActiveIntoView(listRef, active);

        const toggle = (id: number) => {
            const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
            const ids = [...next].sort((a, b) => a - b);
            setSelected(ids);
            const names = list.filter((o) => ids.includes(o.id)).map((o) => o.name);
            onChange(withText(value, names.join(', '), ids));
        };

        return (
            <div style={ROOT_STYLE}>
                <input
                    ref={inputRef}
                    className="gdg-input"
                    style={INPUT_STYLE}
                    type="text"
                    role="textbox"
                    aria-label={labels.search}
                    placeholder={labels.searchPlaceholder}
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            e.stopPropagation();
                            const step = e.key === 'ArrowDown' ? 1 : -1;
                            setActive((a) => Math.min(Math.max(a + step, 0), Math.max(matches.length - 1, 0)));
                        } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                            e.preventDefault();
                            e.stopPropagation();
                            const option = matches[active];
                            if (option) { toggle(option.id); setQuery(''); }
                        }
                    }}
                />
                <ul ref={listRef} role="listbox" aria-multiselectable="true" aria-label={labels.options} style={LIST_STYLE}>
                    {matches.map((o, i) => (
                        <li key={o.id} role="option" aria-selected={selected.includes(o.id)} style={optionStyle(i === active)}
                            onMouseDown={(e) => { e.preventDefault(); toggle(o.id); }}
                            onMouseEnter={() => setActive(i)}>
                            <span aria-hidden="true">{selected.includes(o.id) ? '☑' : '☐'} </span>{o.name}
                        </li>
                    ))}
                    {matches.length === 0 && <li style={{ padding: '5px 8px', color: 'var(--gdg-text-light)' }}>{labels.noResults}</li>}
                </ul>
                <div style={HINT_STYLE}>{labels.multiHint}</div>
            </div>
        );
    }
    return MultiSelectEditor;
};
