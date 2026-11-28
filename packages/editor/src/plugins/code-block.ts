import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { codeBlockConfig } from '@milkdown/kit/component/code-block';
import type { Ctx } from '@milkdown/kit/ctx';
import { basicSetup } from 'codemirror';
import type { EditorLabels } from '../labels.js';

// Mid-lightness hues that read on light and dark surfaces alike.
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: '#6366f1', fontWeight: 600 },
  { tag: [tags.string, tags.special(tags.string)], color: '#10b981' },
  { tag: tags.comment, color: 'var(--ted-muted)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: '#f59e0b' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#ec4899' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: '#0891b2', fontWeight: 600 },
  { tag: tags.attributeName, color: '#f59e0b' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--ted-body)' },
  { tag: tags.propertyName, color: 'var(--ted-fg)' },
]);

const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--ted-fg)', fontSize: '0.875rem' },
  '.cm-content': { fontFamily: 'var(--ted-font-mono)', caretColor: 'var(--ted-fg)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--ted-muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(128, 128, 128, 0.12)' },
  '&.cm-focused': { outline: 'none' },
});

/** Code blocks as CodeMirror 6 editors with syntax highlighting and a language picker. */
export function configureCodeBlock(ctx: Ctx, labels: EditorLabels) {
  ctx.update(codeBlockConfig.key, (defaultConfig) => ({
    ...defaultConfig,
    languages,
    extensions: [basicSetup, editorTheme, syntaxHighlighting(highlightStyle), keymap.of(defaultKeymap.concat(indentWithTab))],
    copyText: labels.copy,
    searchPlaceholder: labels.searchLanguage,
    noResultText: labels.noLanguageResults,
    previewLabel: labels.preview,
    previewLoading: labels.previewLoading,
  }));
}
