import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';

/**
 * Find in document. Decorations only: a search never edits the document, so it
 * is never synced to collaborators nor added to the undo history.
 */
export interface SearchState {
  query: string;
  matches: { from: number; to: number }[];
  /** Index into `matches`; -1 when there are none. */
  current: number;
  decorations: DecorationSet;
}

export const searchPluginKey = new PluginKey<SearchState>('ted-search');

// Not doc.textBetween: its block separator is one character while a block
// boundary is two positions, so highlights drift one character per block.
function flattenDoc(state: EditorState): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i += 1) {
        text += node.text[i];
        positions.push(pos + i);
      }
      return false;
    }
    // A block boundary takes one character (-1) so a match never spans two blocks.
    if (node.isBlock && text.length > 0 && text[text.length - 1] !== '\n') {
      text += '\n';
      positions.push(-1);
    }
    return true;
  });
  return { text, positions };
}

export function findMatches(state: EditorState, query: string): { from: number; to: number }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const { text, positions } = flattenDoc(state);
  const haystack = text.toLowerCase();
  const matches: { from: number; to: number }[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const first = positions[index]!;
    const last = positions[index + needle.length - 1]!;
    if (first !== -1 && last !== -1) matches.push({ from: first, to: last + 1 });
    index = haystack.indexOf(needle, index + 1);
  }
  return matches;
}

function buildDecorations(state: EditorState, matches: { from: number; to: number }[], current: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    state.doc,
    matches.map((match, i) =>
      Decoration.inline(match.from, match.to, { class: i === current ? 'ted-search-match ted-search-match--current' : 'ted-search-match' }),
    ),
  );
}

interface SearchMeta {
  query?: string;
  current?: number;
}

export function searchPlugin(): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchPluginKey,
    state: {
      init: () => ({ query: '', matches: [], current: -1, decorations: DecorationSet.empty }),
      apply(tr: Transaction, value: SearchState, _old: EditorState, newState: EditorState): SearchState {
        const meta = tr.getMeta(searchPluginKey) as SearchMeta | undefined;
        if (meta?.query !== undefined) {
          const matches = findMatches(newState, meta.query);
          const current = matches.length > 0 ? 0 : -1;
          return { query: meta.query, matches, current, decorations: buildDecorations(newState, matches, current) };
        }
        if (meta?.current !== undefined && value.matches.length > 0) {
          // Wraps both ways, like any find bar.
          const total = value.matches.length;
          const current = ((meta.current % total) + total) % total;
          return { ...value, current, decorations: buildDecorations(newState, value.matches, current) };
        }
        // The text changed (typing or a remote edit): search again.
        if (tr.docChanged && value.query) {
          const matches = findMatches(newState, value.query);
          const current = matches.length === 0 ? -1 : Math.min(value.current, matches.length - 1);
          return { ...value, matches, current, decorations: buildDecorations(newState, matches, current) };
        }
        return value;
      },
    },
    props: {
      decorations: (state) => searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  });
}

export function getSearchState(view: EditorView): SearchState | undefined {
  return searchPluginKey.getState(view.state);
}

export function setSearchQuery(view: EditorView, query: string): void {
  view.dispatch(view.state.tr.setMeta(searchPluginKey, { query }));
  scrollCurrentMatchIntoView(view);
}

export function stepSearchMatch(view: EditorView, delta: number): void {
  const state = getSearchState(view);
  if (!state || state.matches.length === 0) return;
  view.dispatch(view.state.tr.setMeta(searchPluginKey, { current: state.current + delta }));
  scrollCurrentMatchIntoView(view);
}

// Scrolls the decorated node, never moves the selection: that would steal
// focus from the search field on every step.
function scrollCurrentMatchIntoView(view: EditorView): void {
  if (typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => {
    view.dom.querySelector('.ted-search-match--current')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
