import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

export const imageLazyKey = new PluginKey('ted-image-lazy');

function markLazy(node: ParentNode): void {
  const images = node.querySelectorAll('img:not([loading])');
  for (let i = 0; i < images.length; i += 1) {
    images[i]!.setAttribute('loading', 'lazy');
    images[i]!.setAttribute('decoding', 'async');
  }
}

/**
 * Images load as they come near the viewport (`loading="lazy"`) instead of all
 * at once when the document opens. Set on the rendered DOM, not the schema, so
 * it never reaches the markdown. A MutationObserver, not the plugin's update(),
 * because update() runs on every key.
 */
export function createImageLazyPlugin(): Plugin {
  return new Plugin({
    key: imageLazyKey,
    view: (view: EditorView) => {
      markLazy(view.dom);
      if (typeof MutationObserver === 'undefined') return {};
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (node.tagName === 'IMG') {
              if (!node.hasAttribute('loading')) {
                node.setAttribute('loading', 'lazy');
                node.setAttribute('decoding', 'async');
              }
            } else {
              markLazy(node);
            }
          });
        }
      });
      observer.observe(view.dom, { childList: true, subtree: true });
      return { destroy: () => observer.disconnect() };
    },
  });
}
