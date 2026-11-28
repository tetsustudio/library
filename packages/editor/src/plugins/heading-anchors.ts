import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { isSafeUrl } from '../lib/safe-url.js';
import { slugify } from '../lib/slugify.js';

function buildDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];
  const seen = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { id: slugify(node.textContent, seen) }));
  });
  return DecorationSet.create(doc, decorations);
}

export const headingAnchorsKey = new PluginKey<DecorationSet>('ted-heading-anchors');

/**
 * Gives every heading a GitHub-style `id`, jumps to `#slug` links, and opens
 * other links on a plain click (phones have no Ctrl/Cmd) when there is no
 * selection and the protocol is safe. To edit a link, select it by dragging.
 */
export function createHeadingAnchorsPlugin(): Plugin {
  return new Plugin({
    key: headingAnchorsKey,
    state: {
      init: (_, state) => buildDecorations(state.doc),
      apply: (tr, set) => (tr.docChanged ? buildDecorations(tr.doc) : set),
    },
    props: {
      decorations(state) {
        return headingAnchorsKey.getState(state);
      },
      handleDOMEvents: {
        click: (view, event) => {
          const target = event.target;
          if (!(target instanceof Element)) return false;
          const href = target.closest('a')?.getAttribute('href');
          if (!href) return false;
          if (href.startsWith('#')) {
            const id = decodeURIComponent(href.slice(1));
            // Inside this editor first: two open documents can share a slug.
            const heading = view.dom.querySelector(`[id="${CSS.escape(id)}"]`) ?? document.getElementById(id);
            if (!heading) return false;
            event.preventDefault();
            heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return true;
          }
          if (!view.state.selection.empty) return false;
          if (!isSafeUrl(href)) return false;
          event.preventDefault();
          window.open(href, '_blank', 'noopener,noreferrer');
          return true;
        },
      },
    },
  });
}
