'use client';

import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { MilkdownProvider } from '@milkdown/react';
import { EditorShell, type EditorBaseProps } from './EditorShell.js';

/** `synced` or `offline` make the editor editable; anything else keeps it read-only while the document loads. */
export type EditorSyncStatus = 'connecting' | 'syncing' | 'synced' | 'offline' | (string & {});

export interface CollaborativeEditorProps extends EditorBaseProps {
  /** The shared document. The app owns the provider (y-websocket, y-indexeddb, your own transport). */
  doc: Y.Doc;
  /** Presence of the same provider: remote cursors and selections. */
  awareness: Awareness;
  /** The provider's state. The editor seeds `initialMarkdown` and starts editing only at `synced` or `offline`. */
  status: EditorSyncStatus;
  /** Written into the document only when it is still empty once synced. */
  initialMarkdown?: string;
}

/** A Milkdown editor bound to a Y.Doc (via @milkdown/plugin-collab), with toolbar, search, spellcheck and image upload. */
export function CollaborativeEditor(props: CollaborativeEditorProps) {
  return (
    <MilkdownProvider>
      <EditorShell {...props} mode="collab" />
    </MilkdownProvider>
  );
}
