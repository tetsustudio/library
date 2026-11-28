import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

export const imageLightboxKey = new PluginKey('ted-image-lightbox');

/**
 * A click on an image opens it full screen. Selecting an image to delete it
 * still works with Backspace after it, or with the block handle.
 */
export function createImageLightboxPlugin(onOpen: (image: { src: string; alt: string }) => void): Plugin {
  return new Plugin({
    key: imageLightboxKey,
    props: {
      handleDOMEvents: {
        click: (_view, event) => {
          const target = event.target;
          if (!(target instanceof HTMLImageElement)) return false;
          const src = target.getAttribute('src');
          if (!src) return false;
          event.preventDefault();
          onOpen({ src, alt: target.getAttribute('alt') ?? '' });
          return true;
        },
      },
    },
  });
}
