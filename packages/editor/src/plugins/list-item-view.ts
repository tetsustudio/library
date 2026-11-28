import { listItemSchema } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { $view } from '@milkdown/kit/utils';

// preset-gfm adds a nullable `checked` attr to list items but renders no
// input. This view draws a real checkbox for task items and a plain <li> otherwise.
export const listItemView = $view(listItemSchema.node, () => {
  return (initialNode, view, getPos): ReturnType<NodeViewConstructor> => {
    const li = document.createElement('li');
    const contentDOM = document.createElement('div');
    contentDOM.className = 'ted-list-item__content';
    let checkbox: HTMLInputElement | null = null;
    let node = initialNode;

    function sync(current: ProseNode) {
      const checked = current.attrs.checked as boolean | null;
      if (checked == null) {
        li.removeAttribute('data-item-type');
        li.classList.remove('task-list-item');
        checkbox?.remove();
        checkbox = null;
        return;
      }
      li.dataset.itemType = 'task';
      li.classList.add('task-list-item');
      if (!checkbox) {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'ted-task-checkbox';
        box.contentEditable = 'false';
        box.addEventListener('mousedown', (event) => event.preventDefault());
        box.addEventListener('change', () => {
          if (!view.editable) return;
          const pos = getPos();
          if (pos == null) return;
          view.dispatch(view.state.tr.setNodeAttribute(pos, 'checked', box.checked));
        });
        li.insertBefore(box, contentDOM);
        checkbox = box;
      }
      checkbox.checked = Boolean(checked);
      checkbox.disabled = !view.editable;
    }

    li.appendChild(contentDOM);
    sync(node);

    return {
      dom: li,
      contentDOM,
      update: (updated) => {
        if (updated.type !== node.type) return false;
        node = updated;
        sync(updated);
        return true;
      },
      ignoreMutation: (mutation) => {
        if (mutation.type === 'selection') return false;
        return mutation.target !== contentDOM && !contentDOM.contains(mutation.target);
      },
    };
  };
});
