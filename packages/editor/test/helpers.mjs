// A minimal EditorView stand-in over a real EditorState: enough for plugin
// props and plugin views that only read state and dispatch.
import { EditorState } from '@milkdown/kit/prose/state';
import { getMarkdownCodec } from '../dist/server.js';

export async function fakeView(markdown, plugins = []) {
  const codec = await getMarkdownCodec();
  const view = {
    state: EditorState.create({ schema: codec.schema, doc: codec.parse(markdown), plugins }),
    isDestroyed: false,
    dispatched: 0,
    dispatch(tr) {
      this.state = this.state.apply(tr);
      this.dispatched++;
    },
    posAtCoords: () => null,
  };
  return { view, codec, markdown: () => codec.serialize(view.state.doc) };
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export function pasteEvent(files) {
  return { clipboardData: { files }, preventDefault() { this.prevented = true; } };
}
