import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';

export const dropIndicatorKey = new PluginKey<DecorationSet>('ted-drop-indicator');

/**
 * The gap between siblings under the pointer, inside whatever container is
 * there (the document for a top-level block, the list for a list item).
 * @milkdown/plugin-block moves blocks with native drag and drop but draws no
 * marker of where they will land.
 */
export function findDropPosition(view: EditorView, clientX: number, clientY: number): number | null {
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (!coords) return null;
  const $pos = view.state.doc.resolve(coords.pos);
  // posAtCoords usually lands inside a paragraph's text: walk up to a container.
  let depth = $pos.depth;
  while (depth > 0 && $pos.node(depth).isTextblock) depth--;
  const parent = $pos.node(depth);
  let childPos = $pos.start(depth);
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const dom = view.nodeDOM(childPos);
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return childPos;
    }
    childPos += child.nodeSize;
  }
  return childPos;
}

export function createDropIndicatorPlugin(): Plugin {
  // Outside plugin state on purpose: it only dedupes the many dragover events
  // per second, it is not part of the document or its history.
  let lastPos: number | null = null;
  const clear = (view: EditorView) => {
    lastPos = null;
    view.dispatch(view.state.tr.setMeta(dropIndicatorKey, null));
    return false;
  };
  return new Plugin({
    key: dropIndicatorKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(dropIndicatorKey) as number | null | undefined;
        if (meta === undefined) return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
        if (meta === null) return DecorationSet.empty;
        return DecorationSet.create(tr.doc, [
          Decoration.widget(
            meta,
            () => {
              const line = document.createElement('div');
              line.className = 'ted-drop-indicator';
              return line;
            },
            { side: -1 },
          ),
        ]);
      },
    },
    props: {
      decorations(state) {
        return dropIndicatorKey.getState(state);
      },
      handleDOMEvents: {
        dragover: (view, event) => {
          // The handle sits in the left margin, where posAtCoords finds
          // nothing: pin x inside the content and let y pick the row.
          const rect = view.dom.getBoundingClientRect();
          const pos = findDropPosition(view, rect.left + rect.width / 2, event.clientY);
          if (pos != null && pos !== lastPos) {
            lastPos = pos;
            view.dispatch(view.state.tr.setMeta(dropIndicatorKey, pos));
          }
          return false;
        },
        dragleave: (view, event) => {
          const related = event.relatedTarget;
          if (!(related instanceof Node) || !view.dom.contains(related)) return clear(view);
          return false;
        },
        drop: (view) => clear(view),
        dragend: (view) => clear(view),
      },
    },
  });
}
