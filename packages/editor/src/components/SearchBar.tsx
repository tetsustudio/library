'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { editorViewCtx, type Editor } from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import { resolveLabels, type EditorLabels } from '../labels.js';
import { getSearchState, setSearchQuery, stepSearchMatch } from '../plugins/search.js';
import { Icon } from './icons.js';

export interface SearchBarProps {
  getEditor: () => Editor | undefined;
  onClose: () => void;
  labels?: Partial<EditorLabels>;
}

/**
 * Find in document. Highlighting and stepping live in the search plugin; this
 * is the control. Focus stays in the field while stepping through matches.
 */
export function SearchBar({ getEditor, onClose, labels: labelOverrides }: SearchBarProps) {
  const labels = resolveLabels(labelOverrides);
  const [query, setQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const withView = useCallback(
    (fn: (view: EditorView) => void) => {
      getEditor()?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        fn(view);
        const state = getSearchState(view);
        setTotal(state?.matches.length ?? 0);
        setCurrent(state?.current ?? -1);
      });
    },
    [getEditor],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Closing clears the highlights.
  useEffect(() => () => getEditor()?.action((ctx) => setSearchQuery(ctx.get(editorViewCtx), '')), [getEditor]);

  useEffect(() => {
    withView((view) => setSearchQuery(view, query));
  }, [query, withView]);

  const step = (delta: number) => withView((view) => stepSearchMatch(view, delta));

  return (
    <div className="ted-search">
      <Icon name="search" className="ted-search__icon" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }
        }}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchPlaceholder}
        className="ted-search__input"
      />
      <span className="ted-search__count" role="status" aria-live="polite">
        {query.trim() === '' ? '' : total === 0 ? labels.searchNoResults : labels.searchCount(current + 1, total)}
      </span>
      <button type="button" onClick={() => step(-1)} disabled={total === 0} title={labels.searchPrevious} aria-label={labels.searchPrevious} className="ted-icon-button">
        <Icon name="chevronUp" />
      </button>
      <button type="button" onClick={() => step(1)} disabled={total === 0} title={labels.searchNext} aria-label={labels.searchNext} className="ted-icon-button">
        <Icon name="chevronDown" />
      </button>
      <button type="button" onClick={onClose} title={labels.searchClose} aria-label={labels.searchClose} className="ted-icon-button">
        <Icon name="x" />
      </button>
    </div>
  );
}
