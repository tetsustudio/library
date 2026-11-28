'use client';

import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { resolveLabels, type EditorLabels } from '../labels.js';
import { createPlainTextSync, type DocumentBridge, type PlainTextSync } from './sync.js';

// Typing reaches the document this long after the last key: a word travels in
// one push, not letter by letter.
const PUSH_DELAY_MS = 120;

// Marks transactions that came from the document so they are not pushed back.
const fromDocument = Annotation.define<boolean>();

const markdownStyle = HighlightStyle.define([
  { tag: tags.heading, class: 'ted-plain__heading' },
  { tag: tags.strong, fontWeight: 600, color: 'var(--ted-fg)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--ted-fg)' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, color: 'var(--ted-brand)' },
  { tag: [tags.link, tags.url], color: 'var(--ted-brand)' },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.list, tags.quote], color: 'var(--ted-muted)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--ted-body)', fontSize: '0.875rem' },
  '.cm-content': { fontFamily: 'var(--ted-font-mono)', lineHeight: '1.5rem', caretColor: 'var(--ted-fg)', padding: '0.5rem 0' },
  // drawSelection() hides the native caret; the base theme paints its own black.
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ted-fg)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { background: 'rgba(128, 128, 128, 0.3)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--ted-muted)', borderRight: '1px solid var(--ted-border)' },
  '.cm-lineNumbers .cm-gutterElement': { fontFamily: 'var(--ted-font-mono)', lineHeight: '1.5rem', paddingRight: '1rem' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(128, 128, 128, 0.08)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-panels': { backgroundColor: 'var(--ted-surface)', color: 'var(--ted-fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--ted-border)' },
});

function readOnlyConfig(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

export interface PlainTextEditorProps {
  /** From an editor's `onReady`. The visual editor stays mounted (it can be hidden) and every change goes through it. */
  bridge: DocumentBridge;
  readOnly?: boolean;
  labels?: Partial<EditorLabels>;
  /** A local change could not be applied and the text went back to the document. */
  onSyncError?: (error: unknown) => void;
  className?: string;
}

/**
 * The document as live, editable markdown (CodeMirror 6) on the same document
 * as the visual editor. It stores nothing itself: changes go through `bridge`
 * into the visual editor and from there into the Y.Doc, like any other edit;
 * what others change comes back the same way.
 */
export function PlainTextEditor({ bridge, readOnly = false, labels: labelOverrides, onSyncError, className }: PlainTextEditorProps) {
  const labels = resolveLabels(labelOverrides);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const ariaLabel = useRef(labels.plainText);
  const onSyncErrorRef = useRef(onSyncError);
  onSyncErrorRef.current = onSyncError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const compartment = readOnlyCompartment.current;
    let sync: PlainTextSync | null = null;

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: bridge.serialize(bridge.getDoc()),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(markdownStyle),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          compartment.of(readOnlyConfig(readOnlyRef.current)),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel.current, spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.transactions.some((tr) => tr.docChanged && !tr.annotation(fromDocument))) sync?.localChange();
          }),
          // Losing focus means "done for now": push without waiting.
          EditorView.domEventHandlers({
            blur: () => {
              sync?.flush();
            },
          }),
        ],
      }),
    });
    viewRef.current = view;

    sync = createPlainTextSync({
      bridge,
      delayMs: PUSH_DELAY_MS,
      buffer: {
        getText: () => view.state.doc.toString(),
        applyRemote: (changes) => {
          view.dispatch({
            changes: changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })),
            annotations: [fromDocument.of(true), Transaction.addToHistory.of(false)],
          });
        },
      },
      onError: (error) => onSyncErrorRef.current?.(error),
    });

    return () => {
      sync?.flush();
      sync?.destroy();
      view.destroy();
      viewRef.current = null;
    };
  }, [bridge]);

  // Reconfigured, not recreated: recreating would lose the caret and the history.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure(readOnlyConfig(readOnly)) });
  }, [readOnly]);

  return <div ref={containerRef} className={className ? `ted-plain ${className}` : 'ted-plain'} />;
}
