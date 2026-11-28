'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { commandsCtx, editorViewCtx, schemaCtx, type CmdKey, type Editor } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import {
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { redo as yRedo, undo as yUndo } from 'y-prosemirror';
import { resolveLabels, type EditorLabels } from '../labels.js';
import type { UploadImage } from '../plugins/image-upload.js';
import { Icon, type IconName } from './icons.js';

export interface EditorToolbarProps {
  getEditor: () => Editor | undefined;
  disabled?: boolean;
  /** Which undo stack the editor runs: Yjs' (collaborative) or ProseMirror's. Default `yjs`. */
  history?: 'yjs' | 'prosemirror';
  /** Shows the image button; the picked file goes through it and its URL is inserted. */
  uploadImage?: UploadImage;
  /** Shows an "Outline" toggle at the end. */
  onOpenOutline?: () => void;
  outlineOpen?: boolean;
  labels?: Partial<EditorLabels>;
}

function toggleTaskListItem(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx);
  const listItemType = ctx.get(schemaCtx).nodes.list_item;
  if (!listItemType) return false;
  const findItem = () => {
    const { $from } = view.state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type === listItemType) return { node, pos: $from.before(depth) };
    }
    return null;
  };
  let item = findItem();
  if (!item) {
    if (!ctx.get(commandsCtx).call(wrapInBulletListCommand.key)) return false;
    item = findItem();
  }
  if (!item) return false;
  view.dispatch(view.state.tr.setNodeAttribute(item.pos, 'checked', item.node.attrs.checked == null ? false : null));
  return true;
}

// toggleInlineCodeCommand bails on an empty selection, unlike bold/italic
// (toggleMark sets stored marks). Same stored-mark behavior by hand, so typing
// right after the click produces inline code.
function toggleInlineCode(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  if (!state.selection.empty) return ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
  const markType = ctx.get(schemaCtx).marks.inlineCode;
  if (!markType) return false;
  const active = state.storedMarks ? markType.isInSet(state.storedMarks) != null : state.selection.$from.marks().some((m) => m.type === markType);
  view.dispatch(active ? state.tr.removeStoredMark(markType) : state.tr.addStoredMark(markType.create()));
  return true;
}

interface ToolbarItem {
  label: string;
  icon: IconName;
  onClick: () => void;
  spin?: boolean;
}

/** Formatting bar for an editor from this package. One row; scrolls sideways on narrow screens. */
export function EditorToolbar({ getEditor, disabled, history = 'yjs', uploadImage, onOpenOutline, outlineOpen, labels: labelOverrides }: EditorToolbarProps) {
  const labels = resolveLabels(labelOverrides);
  const [showOverflow, setShowOverflow] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const run = (action: (ctx: Ctx) => unknown) => {
    getEditor()?.action(action);
  };

  const onImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared every time, or picking the same file twice fires no change.
    event.target.value = '';
    if (!file || !uploadImage) return;
    setUploading(true);
    setImageError(null);
    try {
      const { url, alt } = await uploadImage(file);
      run((ctx) => ctx.get(commandsCtx).call(insertImageCommand.key, { src: url, alt: alt ?? file.name }));
    } catch (error) {
      setImageError(error instanceof Error && error.message ? error.message : labels.imageUploadFailed);
      setTimeout(() => setImageError(null), 5000);
    } finally {
      setUploading(false);
    }
  };

  const command =
    <T,>(key: CmdKey<T>, payload?: T) =>
    () =>
      run((ctx) => ctx.get(commandsCtx).call(key, payload));

  const primary: ToolbarItem[] = [
    { label: labels.bold, icon: 'bold', onClick: command(toggleStrongCommand.key) },
    { label: labels.italic, icon: 'italic', onClick: command(toggleEmphasisCommand.key) },
    { label: labels.inlineCode, icon: 'code', onClick: () => run(toggleInlineCode) },
    { label: labels.heading1, icon: 'heading1', onClick: command(wrapInHeadingCommand.key, 1) },
    { label: labels.heading2, icon: 'heading2', onClick: command(wrapInHeadingCommand.key, 2) },
    { label: labels.bulletList, icon: 'list', onClick: command(wrapInBulletListCommand.key) },
    { label: labels.numberedList, icon: 'listOrdered', onClick: command(wrapInOrderedListCommand.key) },
  ];
  if (uploadImage) {
    primary.push({
      label: uploading ? labels.uploadingImage : labels.insertImage,
      icon: uploading ? 'loader' : 'imagePlus',
      spin: uploading,
      onClick: () => imageInputRef.current?.click(),
    });
  }

  const overflow: ToolbarItem[] = [
    { label: labels.checklist, icon: 'listChecks', onClick: () => run(toggleTaskListItem) },
    { label: labels.quote, icon: 'quote', onClick: command(wrapInBlockquoteCommand.key) },
    {
      label: labels.link,
      icon: 'link',
      onClick: () =>
        run((ctx) => {
          const href = window.prompt(labels.linkPrompt);
          if (href) ctx.get(commandsCtx).call(toggleLinkCommand.key, { href });
        }),
    },
    {
      label: labels.undo,
      icon: 'undo',
      onClick: () => run((ctx) => (history === 'yjs' ? yUndo(ctx.get(editorViewCtx).state) : ctx.get(commandsCtx).call(undoCommand.key))),
    },
    {
      label: labels.redo,
      icon: 'redo',
      onClick: () => run((ctx) => (history === 'yjs' ? yRedo(ctx.get(editorViewCtx).state) : ctx.get(commandsCtx).call(redoCommand.key))),
    },
  ];

  const renderButton = ({ label, icon, onClick, spin }: ToolbarItem) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="ted-toolbar__button"
    >
      <Icon name={icon} className={spin ? 'ted-spin' : undefined} />
    </button>
  );

  return (
    <div className="ted-toolbar">
      {/* Above the bar, not window.alert: an alert blocks for something that clears itself. */}
      {imageError && (
        <p role="status" className="ted-toolbar__error">
          {imageError}
        </p>
      )}
      <div className="ted-toolbar__row">
        {uploadImage && (
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={onImageSelected}
            className="ted-hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
        )}
        {primary.map(renderButton)}
        <button
          type="button"
          title={showOverflow ? labels.fewerOptions : labels.moreOptions}
          aria-label={showOverflow ? labels.fewerOptions : labels.moreOptions}
          aria-expanded={showOverflow}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setShowOverflow((prev) => !prev)}
          className="ted-toolbar__button ted-toolbar__more"
        >
          <Icon name="more" />
        </button>
        <div className="ted-toolbar__overflow" data-open={showOverflow}>
          {overflow.map(renderButton)}
        </div>
        {onOpenOutline && (
          <>
            <div className="ted-toolbar__divider" />
            <button
              type="button"
              title={labels.outline}
              aria-label={labels.outline}
              aria-pressed={outlineOpen}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onOpenOutline}
              className="ted-toolbar__button"
              data-active={outlineOpen ? 'true' : undefined}
            >
              <Icon name="outline" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
