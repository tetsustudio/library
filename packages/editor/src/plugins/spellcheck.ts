import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection, type PluginView } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { EditorLabels } from '../labels.js';
import type { SpellChecker, SpellcheckController } from '../spellcheck/controller.js';
import type { SpellcheckLanguage } from '../spellcheck/settings.js';
import { accentOnlyFixes, rankSuggestions, tokenizeText, trailingWord } from '../spellcheck/tokenize.js';

export const spellcheckKey = new PluginKey<DecorationSet>('ted-spellcheck');
const DEBOUNCE_MS = 500;
const MAX_SUGGESTIONS = 5;
// Characters that end a word: the moment auto-accent acts on it.
const WORD_BOUNDARY_INPUT = /^[\s.,;:!?)\]}"'»…]$/;
// Longer than any word; avoids reading the whole paragraph on every key.
const WORD_LOOKBEHIND = 64;

/** Inline decorations over every misspelled word, skipping code blocks and inline code. */
export function buildSpellcheckDecorations(doc: ProseNode, spell: Pick<SpellChecker, 'correct'>): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    // The schema's own "this is code" flags, not hardcoded type names.
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text) return;
    if (node.marks.some((mark) => mark.type.spec.code)) return;
    for (const token of tokenizeText(node.text)) {
      if (spell.correct(token.text)) continue;
      decorations.push(Decoration.inline(pos + token.start, pos + token.end, { class: 'ted-spell-error' }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

class SpellcheckPopup {
  private dom: HTMLElement | null = null;
  // Capture phase: anything in between may stopPropagation() (the block
  // handle does). pointerdown so touch and pen dismiss it too.
  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.dom && !this.dom.contains(event.target as Node)) this.close();
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.close();
  };
  // The popup is position:fixed at open time; once anything scrolls it would
  // sit over other text, so it closes instead of tracking.
  private readonly onViewportChange = () => this.close();

  constructor(
    private readonly spellcheck: SpellcheckController,
    private readonly labels: EditorLabels,
    private readonly onIgnore: (word: string) => void,
  ) {
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
  }

  isOpen(): boolean {
    return this.dom != null;
  }

  open(view: EditorView, from: number, to: number, word: string, language: SpellcheckLanguage) {
    this.close();
    const spell = this.spellcheck.getCached(language);
    const suggestions = spell ? rankSuggestions(word, spell.suggest(word)).slice(0, MAX_SUGGESTIONS) : [];

    const container = document.createElement('div');
    container.className = 'ted-spell-popup';

    // The word (the popup usually covers it) and a visible close button: on
    // touch the outside tap that should dismiss it often never arrives.
    const header = document.createElement('div');
    header.className = 'ted-spell-popup__header';
    const label = document.createElement('span');
    label.className = 'ted-spell-popup__word';
    label.textContent = word;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'ted-spell-popup__close';
    closeButton.setAttribute('aria-label', this.labels.close);
    closeButton.textContent = '×';
    closeButton.addEventListener('mousedown', (event) => event.preventDefault());
    closeButton.addEventListener('click', (event) => {
      event.preventDefault();
      this.close();
      view.focus();
    });
    header.append(label, closeButton);
    container.append(header);

    const addItem = (text: string, className: string, onSelect: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = text;
      // Keeps the editor selection: a mousedown outside the contenteditable
      // would blur it before the click runs.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        onSelect();
      });
      container.append(button);
    };

    if (suggestions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ted-spell-popup__empty';
      empty.textContent = this.labels.noSuggestions;
      container.append(empty);
    } else {
      for (const suggestion of suggestions) {
        addItem(suggestion, 'ted-spell-popup__item', () => this.replaceWord(view, from, to, suggestion));
      }
    }

    const divider = document.createElement('div');
    divider.className = 'ted-spell-popup__divider';
    container.append(divider);
    addItem(this.labels.ignoreWord(word), 'ted-spell-popup__item ted-spell-popup__ignore', () => {
      this.close();
      view.focus();
      this.onIgnore(word);
    });

    const coords = view.coordsAtPos(from);
    container.style.position = 'fixed';
    container.style.top = `${coords.bottom + 4}px`;
    container.style.left = `${Math.min(coords.left, window.innerWidth - 240)}px`;
    document.body.append(container);
    this.dom = container;

    // When it does not fit below the word, it opens above it.
    const height = container.offsetHeight;
    if (coords.bottom + 4 + height > window.innerHeight - 8) {
      container.style.top = `${Math.max(8, coords.top - height - 4)}px`;
    }
  }

  close() {
    this.dom?.remove();
    this.dom = null;
  }

  destroy() {
    this.close();
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
  }

  private replaceWord(view: EditorView, from: number, to: number, replacement: string) {
    const tr = view.state.tr.insertText(replacement, from, to);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + replacement.length)));
    view.dispatch(tr.scrollIntoView());
    this.close();
    view.focus();
  }
}

// Wherever the browser underlines natively (touch), this plugin does not.
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function isTouchContextMenu(event: MouseEvent): boolean {
  if ('pointerType' in event && (event as PointerEvent).pointerType === 'touch') return true;
  return isTouchDevice();
}

export interface SpellcheckPluginOptions {
  spellcheck: SpellcheckController;
  labels: EditorLabels;
}

/**
 * Underlines misspelled words, offers suggestions on right click and, when
 * enabled, fixes a missing accent when the word ends. State is per plugin
 * instance (popup, timer, loaded dictionary) so editors never cross-talk.
 */
export function createSpellcheckPlugin({ spellcheck, labels }: SpellcheckPluginOptions): Plugin {
  let currentSpell: SpellChecker | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let { language: currentLanguage, enabled, autoAccent } = spellcheck.getSettings();

  // Only rewrites accents, and only when there is exactly one accent-only
  // fix: ambiguous pairs ("mas"/"más", "esta"/"está") are both correct words
  // and never reach this point.
  function autoAccentInput(view: EditorView, from: number, to: number, text: string): boolean {
    if (!enabled || !autoAccent || !currentSpell) return false;
    if (!WORD_BOUNDARY_INPUT.test(text)) return false;
    const $from = view.state.doc.resolve(from);
    if ($from.parent.type.spec.code) return false;
    if ($from.marks().some((mark) => mark.type.spec.code)) return false;
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - WORD_LOOKBEHIND), $from.parentOffset);
    const word = trailingWord(before);
    if (!word || currentSpell.correct(word)) return false;
    const fixes = accentOnlyFixes(word, currentSpell.suggest(word));
    if (fixes.length !== 1) return false;
    const fixed = fixes[0]!;
    // Accents are single code points: same length, positions stay valid.
    if (fixed.length !== word.length || fixed === word) return false;
    view.dispatch(view.state.tr.insertText(fixed, from - word.length, from).insertText(text, from, to));
    return true;
  }

  function runPass(view: EditorView) {
    if (view.isDestroyed) return;
    if (!enabled || !currentSpell) return;
    // On touch the dictionary still loads for auto-accent; underlines are
    // left to the native checker, or every mistake shows twice.
    if (isTouchDevice()) return;
    view.dispatch(view.state.tr.setMeta(spellcheckKey, buildSpellcheckDecorations(view.state.doc, currentSpell)));
  }

  function schedulePass(view: EditorView, delayMs: number) {
    if (debounceTimer != null) clearTimeout(debounceTimer);
    if (!enabled) return;
    debounceTimer = setTimeout(() => {
      if (currentSpell) return runPass(view);
      const language = currentLanguage;
      spellcheck.load(language).then(
        (spell) => {
          if (language !== currentLanguage) return;
          currentSpell = spell;
          runPass(view);
        },
        () => {
          // No dictionary (not copied, offline): the editor works without underlines.
        },
      );
    }, delayMs);
  }

  // addPersonalWord notifies subscribers, which rescans: no extra pass here.
  const popup = new SpellcheckPopup(spellcheck, labels, (word) => spellcheck.addPersonalWord(currentLanguage, word));

  return new Plugin({
    key: spellcheckKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(spellcheckKey) as DecorationSet | undefined;
        if (meta) return meta;
        return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
      },
    },
    props: {
      decorations(state) {
        return spellcheckKey.getState(state);
      },
      handleTextInput(view, from, to, text) {
        return autoAccentInput(view, from, to, text);
      },
      handleDOMEvents: {
        contextmenu(view, event) {
          if (!enabled) return false;
          // A long-press is native text selection: never cancel it on touch.
          if (isTouchContextMenu(event)) return false;
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!coords) return false;
          const found = spellcheckKey.getState(view.state)?.find(coords.pos, coords.pos) ?? [];
          const hit = found[0];
          if (!hit) return false;
          event.preventDefault();
          popup.open(view, hit.from, hit.to, view.state.doc.textBetween(hit.from, hit.to), currentLanguage);
          return true;
        },
      },
    },
    view(editorView) {
      // Off the first paint: the dictionary fetch never competes with mounting.
      const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0);
      idle(() => {
        if (editorView.isDestroyed) return;
        schedulePass(editorView, 0);
      });

      const unsubscribe = spellcheck.subscribe(() => {
        const settings = spellcheck.getSettings();
        const languageChanged = settings.language !== currentLanguage;
        currentLanguage = settings.language;
        enabled = settings.enabled;
        autoAccent = settings.autoAccent;
        if (debounceTimer != null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        if (editorView.isDestroyed) return;
        if (!enabled) {
          popup.close();
          editorView.dispatch(editorView.state.tr.setMeta(spellcheckKey, DecorationSet.empty));
          return;
        }
        if (languageChanged) currentSpell = null;
        schedulePass(editorView, 0);
      });

      return {
        update(view, prevState) {
          if (view.state.doc === prevState.doc) return;
          if (popup.isOpen()) popup.close();
          schedulePass(view, DEBOUNCE_MS);
        },
        destroy() {
          popup.destroy();
          unsubscribe();
          if (debounceTimer != null) clearTimeout(debounceTimer);
        },
      } satisfies PluginView;
    },
  });
}
