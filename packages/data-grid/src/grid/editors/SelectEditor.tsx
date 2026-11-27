import { useContext, useMemo, useRef, useState } from 'react';
import type { GridColumnDef, Option } from '../../model/gridModel.js';
import { useEditorFocus, useScrollActiveIntoView } from '../hooks/useEditorFocus.js';
import { GridEditorContext } from './GridEditorContext.js';
import {
    HINT_STYLE, INPUT_STYLE, LIST_STYLE, ROOT_STYLE, normalize, optionStyle, withText,
    type EditorProps, type SeenCell,
} from './editorTypes.js';

const MAX_VISIBLE = 100;
export const NO_OPTIONS: Option[] = [];

/** Prefix matches first, then the rest, both in the original order. */
export const filterOptions = (list: Option[], query: string): Option[] => {
    const q = normalize(query.trim());
    if (!q) return list.slice(0, MAX_VISIBLE);
    const starts: Option[] = [];
    const contains: Option[] = [];
    for (const o of list) {
        const n = normalize(o.name);
        if (n.startsWith(q)) starts.push(o);
        else if (n.includes(q)) contains.push(o);
    }
    return [...starts, ...contains].slice(0, MAX_VISIBLE);
};

/**
 * Searchable dropdown for a foreign key: type to filter, ArrowUp/Down to move,
 * Enter picks and moves down, Tab picks and moves right, Esc cancels.
 */
export const makeSelectEditor = (col: GridColumnDef) => {
    function SelectEditor({ value, initialValue, onFinishedEditing }: EditorProps) {
        const { options, labels } = useContext(GridEditorContext);
        const list = options[col.optionsKey ?? ''] ?? NO_OPTIONS;
        const currentId = (value as SeenCell).__seen?.base;
        const [query, setQuery] = useState(initialValue ?? '');
        const matches = useMemo(() => filterOptions(list, query), [list, query]);
        const [active, setActive] = useState(() => {
            const i = filterOptions(list, initialValue ?? '').findIndex((o) => o.id === currentId);
            return initialValue === undefined && i >= 0 ? i : 0;
        });
        const touched = useRef(initialValue !== undefined);
        const inputRef = useEditorFocus(initialValue);
        const listRef = useRef<HTMLUListElement>(null);
        useScrollActiveIntoView(listRef, active);

        const pick = (option: Option, movement: readonly [-1 | 0 | 1, -1 | 0 | 1]) =>
            onFinishedEditing(withText(value, option.name, option.id), movement);

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
                    onChange={(e) => { touched.current = true; setQuery(e.target.value); setActive(0); }}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            e.stopPropagation();
                            touched.current = true;
                            const step = e.key === 'ArrowDown' ? 1 : -1;
                            setActive((a) => Math.min(Math.max(a + step, 0), Math.max(matches.length - 1, 0)));
                        } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                            // Own the key: Glide's wrapper would commit a stale value.
                            e.preventDefault();
                            e.stopPropagation();
                            const option = matches[active];
                            if (option) pick(option, [0, 1]);
                        } else if (e.key === 'Tab' && touched.current && matches[active]) {
                            e.preventDefault();
                            e.stopPropagation();
                            pick(matches[active]!, [e.shiftKey ? -1 : 1, 0]);
                        }
                    }}
                />
                <ul ref={listRef} role="listbox" aria-label={labels.options} style={LIST_STYLE}>
                    {matches.map((o, i) => (
                        <li key={o.id} role="option" aria-selected={i === active} style={optionStyle(i === active)}
                            onMouseDown={(e) => { e.preventDefault(); pick(o, [0, 0]); }}
                            onMouseEnter={() => setActive(i)}>
                            {o.name}
                        </li>
                    ))}
                    {matches.length === 0 && <li style={{ padding: '5px 8px', color: 'var(--gdg-text-light)' }}>{labels.noResults}</li>}
                </ul>
                <div style={HINT_STYLE}>{labels.selectHint}</div>
            </div>
        );
    }
    return SelectEditor;
};
