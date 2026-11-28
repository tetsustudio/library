import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { EditorLabels } from '../labels.js';
import { resolveHiddenBlocks } from '../lib/heading-sections.js';
import { slugify } from '../lib/slugify.js';
import { readJsonList, type EditorStorage } from '../storage.js';

// Collapsing is a reading preference of this user on this device, never
// document content: it lives in view decorations and storage, not the Y.Doc,
// so folding a section never folds it for a collaborator.

const HIDDEN_CLASS = 'ted-heading-hidden';
const COLLAPSED_CLASS = 'ted-heading-collapsed';
const TOGGLE_CLASS = 'ted-heading-toggle';

interface CollapseState {
  collapsed: Set<string>;
  decorations: DecorationSet;
}

export const headingCollapseKey = new PluginKey<CollapseState>('ted-heading-collapse');

// Same walk and slugify as the anchors plugin: the ids must be identical.
function headingIdsByPos(doc: ProseNode): Map<number, string> {
  const ids = new Map<number, string>();
  const seen = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    ids.set(pos, slugify(node.textContent, seen));
  });
  return ids;
}

function createToggle(collapsed: boolean, labels: EditorLabels): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = TOGGLE_CLASS;
  const label = collapsed ? labels.expandSection : labels.collapseSection;
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  // Otherwise the caret can enter it and Backspace deletes it.
  button.contentEditable = 'false';
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
  return button;
}

function buildDecorations(doc: ProseNode, collapsed: Set<string>, labels: EditorLabels): DecorationSet {
  const ids = headingIdsByPos(doc);
  const decorations: Decoration[] = [];
  // Top level only: a section is the siblings after its heading.
  const blocks: { node: ProseNode; offset: number; level: number; id: string | null }[] = [];
  doc.forEach((node, offset) => {
    const isHeading = node.type.name === 'heading';
    blocks.push({ node, offset, level: isHeading ? Number(node.attrs.level) || 1 : 0, id: isHeading ? (ids.get(offset) ?? null) : null });
  });
  const hidden = resolveHiddenBlocks(
    blocks.map((b) => b.level),
    (index) => {
      const id = blocks[index]!.id;
      return id !== null && collapsed.has(id);
    },
  );
  blocks.forEach(({ node, offset, id }, index) => {
    if (hidden[index]) {
      decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: HIDDEN_CLASS }));
      return;
    }
    if (id === null) return;
    const isCollapsed = collapsed.has(id);
    if (isCollapsed) decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: COLLAPSED_CLASS }));
    // At the end of the heading text, away from the block handle on the left.
    decorations.push(
      Decoration.widget(offset + node.nodeSize - 1, () => createToggle(isCollapsed, labels), {
        side: 1,
        ignoreSelection: true,
        key: `${id}:${isCollapsed ? 'c' : 'e'}`,
      }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

function findHeading(doc: ProseNode, id: string): { pos: number; node: ProseNode } | null {
  const ids = headingIdsByPos(doc);
  let found: { pos: number; node: ProseNode } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'heading' && ids.get(pos) === id) found = { pos, node };
    return true;
  });
  return found;
}

function toggleAt(view: EditorView, id: string): void {
  const state = headingCollapseKey.getState(view.state);
  if (!state) return;
  const collapsed = new Set(state.collapsed);
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  const tr = view.state.tr.setMeta(headingCollapseKey, { collapsed });
  // A caret inside what gets hidden would type blind: move it to the heading.
  const heading = findHeading(view.state.doc, id);
  if (heading && collapsed.has(id) && view.state.selection.from > heading.pos) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(heading.pos + heading.node.nodeSize - 1)));
  }
  view.dispatch(tr);
}

export interface HeadingCollapseOptions {
  /** Collapsed headings are remembered per document; without an id they live in memory. */
  documentId: string | null;
  storage: EditorStorage;
  storagePrefix: string;
  labels: EditorLabels;
}

export function createHeadingCollapsePlugin({ documentId, storage, storagePrefix, labels }: HeadingCollapseOptions): Plugin {
  const key = documentId ? `${storagePrefix}-collapsed-headings:${documentId}` : null;
  const read = () => new Set(key ? readJsonList(storage, key) : []);
  const write = (collapsed: Set<string>) => {
    if (key) storage.set(key, JSON.stringify([...collapsed]));
  };
  return new Plugin<CollapseState>({
    key: headingCollapseKey,
    state: {
      init: (_, state) => {
        const collapsed = read();
        return { collapsed, decorations: buildDecorations(state.doc, collapsed, labels) };
      },
      apply: (tr, value, _old, newState) => {
        const meta = tr.getMeta(headingCollapseKey) as { collapsed?: Set<string> } | undefined;
        if (meta?.collapsed) {
          write(meta.collapsed);
          return { collapsed: meta.collapsed, decorations: buildDecorations(newState.doc, meta.collapsed, labels) };
        }
        if (!tr.docChanged) return value;
        // A renamed heading gets a new slug and its section expands again: accepted.
        return { collapsed: value.collapsed, decorations: buildDecorations(newState.doc, value.collapsed, labels) };
      },
    },
    props: {
      decorations(state) {
        return headingCollapseKey.getState(state)?.decorations;
      },
      handleDOMEvents: {
        // mousedown, not click: by click time ProseMirror already moved the selection.
        mousedown: (view, event) => {
          const target = event.target;
          if (!(target instanceof Element)) return false;
          const toggle = target.closest(`.${TOGGLE_CLASS}`);
          if (!toggle) return false;
          const id = toggle.closest('[id]')?.getAttribute('id');
          if (!id) return false;
          event.preventDefault();
          event.stopPropagation();
          toggleAt(view, id);
          return true;
        },
      },
    },
  });
}
