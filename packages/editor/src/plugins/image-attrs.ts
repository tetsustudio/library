import type { Ctx } from '@milkdown/kit/ctx';
import { imageSchema } from '@milkdown/kit/preset/commonmark';

/**
 * Milkdown 7.21's image schema validates `title` and `alt` as strings, but the
 * markdown parser passes mdast's `title: null` for `![a](url)`. prosemirror-model
 * >= 1.22 validates on create and the image was silently lost. Missing values
 * parse to `''`; an empty title serializes back to absent (no `![a](url "")`).
 */
export function configureImageAttrs(ctx: Ctx) {
  ctx.update(imageSchema.key, (previous) => (c) => {
    const base = previous(c);
    return {
      ...base,
      parseMarkdown: {
        ...base.parseMarkdown,
        runner: (state, node, type) => base.parseMarkdown.runner(state, { ...node, title: node.title ?? '', alt: node.alt ?? '' }, type),
      },
      toMarkdown: {
        ...base.toMarkdown,
        runner: (state, node) => {
          state.addNode('image', undefined, undefined, { title: node.attrs.title || null, url: node.attrs.src, alt: node.attrs.alt });
        },
      },
    };
  });
}
