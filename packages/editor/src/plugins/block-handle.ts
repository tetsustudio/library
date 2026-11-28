import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { paragraphSchema } from '@milkdown/kit/preset/commonmark';
import { findParent } from '@milkdown/kit/prose';
import { block, blockConfig, BlockProvider } from '@milkdown/kit/plugin/block';
import { TextSelection, type PluginView } from '@milkdown/kit/prose/state';
import type { EditorLabels } from '../labels.js';

const ADD_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const DRAG_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>';

// BlockProvider places this DOM next to the hovered block and handles the
// drag itself; this view only builds the handle and implements "+".
class BlockHandleView implements PluginView {
  private readonly content: HTMLElement;
  private readonly provider: BlockProvider;

  constructor(private readonly ctx: Ctx, labels: EditorLabels) {
    const content = document.createElement('div');
    content.className = 'ted-block-handle';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'ted-block-handle__button';
    addButton.setAttribute('aria-label', labels.addBlock);
    addButton.innerHTML = ADD_ICON;
    // Keeps the container's mousedown (which starts a drag) from firing.
    addButton.addEventListener('mousedown', (event) => event.stopPropagation());
    addButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onAdd();
    });

    const dragHandle = document.createElement('div');
    dragHandle.className = 'ted-block-handle__button ted-block-handle__drag';
    dragHandle.setAttribute('aria-label', labels.dragBlock);
    dragHandle.innerHTML = DRAG_ICON;

    content.append(addButton, dragHandle);
    this.content = content;

    this.provider = new BlockProvider({
      ctx,
      content,
      // Inside the editor's left padding, not outside its box: posAtCoords and
      // native drop only resolve positions within the editable element.
      getPlacement: () => 'right',
      getOffset: () => 8,
      // One fixed column at the editor's left edge; only the vertical
      // position follows the hovered block, so nested items do not drift.
      getPosition: ({ editorDom, active }) => {
        const editorRect = editorDom.getBoundingClientRect();
        const activeRect = active.el.getBoundingClientRect();
        return {
          x: editorRect.left,
          y: activeRect.top,
          left: editorRect.left,
          right: editorRect.left,
          top: activeRect.top,
          bottom: activeRect.bottom,
          width: 0,
          height: activeRect.height,
        };
      },
    });
    this.update();
  }

  update = () => {
    this.provider.update();
  };

  destroy = () => {
    this.provider.destroy();
    this.content.remove();
  };

  onAdd = () => {
    const view = this.ctx.get(editorViewCtx);
    if (!view.hasFocus()) view.focus();
    const active = this.provider.active;
    if (!active) return;
    const pos = active.$pos.pos + active.node.nodeSize;
    let tr = view.state.tr.insert(pos, paragraphSchema.type(this.ctx).create());
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
    view.dispatch(tr.scrollIntoView());
    this.provider.hide();
  };
}

export function configureBlockHandle(ctx: Ctx, labels: EditorLabels) {
  ctx.set(blockConfig.key, {
    // Table cells and blockquote content edit in place: no handle there.
    filterNodes: (pos) => !findParent((node) => ['table', 'blockquote'].includes(node.type.name))(pos),
  });
  ctx.set(block.key, { view: () => new BlockHandleView(ctx, labels) });
}

const AUTOSCROLL_EDGE_PX = 56;
const AUTOSCROLL_SPEED_PX = 18;

export function findScrollParent(el: HTMLElement): HTMLElement {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * @milkdown/plugin-block only auto-scrolls `view.dom.parentElement` while
 * dragging. This drives the real scrolling ancestor of this editor (scoped by
 * `getRoot`, so several editors on one page do not drive the same pane).
 */
export function setupBlockDragAutoScroll(getRoot: () => HTMLElement | null): () => void {
  let rafId: number | null = null;
  let clientY = 0;
  const tick = () => {
    rafId = requestAnimationFrame(tick);
    const editorDom = getRoot()?.querySelector<HTMLElement>('.ProseMirror');
    if (!editorDom || editorDom.dataset.dragging !== 'true') return;
    const scrollParent = findScrollParent(editorDom);
    const rect = scrollParent.getBoundingClientRect();
    if (clientY - rect.top < AUTOSCROLL_EDGE_PX) scrollParent.scrollTop -= AUTOSCROLL_SPEED_PX;
    else if (rect.bottom - clientY < AUTOSCROLL_EDGE_PX) scrollParent.scrollTop += AUTOSCROLL_SPEED_PX;
  };
  const onDragOver = (event: DragEvent) => {
    clientY = event.clientY;
  };
  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch) clientY = touch.clientY;
  };
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('touchmove', onTouchMove, { passive: true });
  rafId = requestAnimationFrame(tick);
  return () => {
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('touchmove', onTouchMove);
    if (rafId != null) cancelAnimationFrame(rafId);
  };
}
