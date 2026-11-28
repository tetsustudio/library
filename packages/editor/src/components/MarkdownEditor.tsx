'use client';

import { MilkdownProvider } from '@milkdown/react';
import { EditorShell, type EditorBaseProps } from './EditorShell.js';

export interface MarkdownEditorProps extends EditorBaseProps {
  /** The starting markdown. Read when the editor mounts (and again when `documentId` changes). */
  initialMarkdown?: string;
}

/** The same editor without collaboration: markdown in (`initialMarkdown`), markdown out (`onMarkdownChange`), local undo history. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <MilkdownProvider>
      <EditorShell {...props} mode="local" />
    </MilkdownProvider>
  );
}
