import type { Ctx } from '@milkdown/kit/ctx';
import { bulletListSchema, orderedListSchema } from '@milkdown/kit/preset/commonmark';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';
import type { Node } from '@milkdown/kit/prose/model';

type SpreadFormat = 'boolean' | 'string';

function isLoose(spread: unknown): boolean {
  return spread === true || spread === 'true';
}

function withSpread(node: Node, format: SpreadFormat): Node {
  const loose = isLoose(node.attrs.spread);
  return node.type.create({ ...node.attrs, spread: format === 'boolean' ? loose : String(loose) }, node.content, node.marks);
}

/**
 * Milkdown 7.21 disagrees with itself about the lists' `spread` attr: the
 * schema validates a boolean, the markdown parser creates a string, and
 * prosemirror-model >= 1.22 throws (`Expected value of type boolean for
 * attribute spread`), losing every parsed list. The serializers also read it
 * two ways. Both types are accepted and each serializer gets the format it expects.
 */
export function configureListSpread(ctx: Ctx) {
  const fixes: Array<{
    schema: typeof bulletListSchema | typeof orderedListSchema | typeof extendListItemSchemaForTask;
    format: (node: Node) => SpreadFormat;
  }> = [
    { schema: bulletListSchema, format: () => 'boolean' },
    { schema: orderedListSchema, format: () => 'string' },
    // The GFM item delegates to commonmark's when it is not a task.
    { schema: extendListItemSchemaForTask, format: (node) => (node.attrs.checked == null ? 'boolean' : 'string') },
  ];
  for (const { schema, format } of fixes) {
    ctx.update(schema.key, (previous) => (c) => {
      const base = previous(c);
      const spread = base.attrs?.spread;
      if (!spread) return base;
      return {
        ...base,
        attrs: { ...base.attrs, spread: { ...spread, validate: 'boolean|string' } },
        toMarkdown: { ...base.toMarkdown, runner: (state, node) => base.toMarkdown.runner(state, withSpread(node, format(node))) },
      };
    });
  }
}
