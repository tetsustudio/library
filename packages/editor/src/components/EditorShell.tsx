'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, prosePluginsCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { codeBlockComponent } from '@milkdown/kit/component/code-block';
import { block } from '@milkdown/kit/plugin/block';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { cursor as dropCursor } from '@milkdown/kit/plugin/cursor';
import { history } from '@milkdown/kit/plugin/history';
import { indent } from '@milkdown/kit/plugin/indent';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { trailing } from '@milkdown/kit/plugin/trailing';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { collab, collabServiceCtx } from '@milkdown/plugin-collab';
import { Milkdown, useEditor } from '@milkdown/react';
import { resolveLabels, type EditorLabels } from '../labels.js';
import type { DocumentBridge } from '../plain-text/sync.js';
import { configureBlockHandle, setupBlockDragAutoScroll } from '../plugins/block-handle.js';
import { configureCodeBlock } from '../plugins/code-block.js';
import { createDropIndicatorPlugin } from '../plugins/drop-indicator.js';
import { createHeadingAnchorsPlugin } from '../plugins/heading-anchors.js';
import { createHeadingCollapsePlugin } from '../plugins/heading-collapse.js';
import { configureImageAttrs } from '../plugins/image-attrs.js';
import { createImageLazyPlugin } from '../plugins/image-lazy.js';
import { createImageLightboxPlugin } from '../plugins/image-lightbox.js';
import { createImageUploadPlugin, type UploadImage } from '../plugins/image-upload.js';
import { listItemView } from '../plugins/list-item-view.js';
import { configureListSpread } from '../plugins/list-spread.js';
import { searchPlugin } from '../plugins/search.js';
import { createSpellcheckPlugin, isTouchDevice } from '../plugins/spellcheck.js';
import { getSpellcheck, type SpellcheckController } from '../spellcheck/controller.js';
import { DEFAULT_STORAGE_PREFIX, localStorageAdapter, type EditorStorage } from '../storage.js';
import { EditorToolbar } from './EditorToolbar.js';
import { ImageLightbox } from './ImageLightbox.js';
import { SearchBar } from './SearchBar.js';

/** What `onReady` hands out once the editor is bound and editable: the document bridge plus the Milkdown editor. */
export interface EditorApi extends DocumentBridge {
  editor: Editor;
  /** The document as markdown, now. */
  getMarkdown(): string;
  focus(): void;
}

/** Props shared by `CollaborativeEditor` and `MarkdownEditor`. */
export interface EditorBaseProps {
  /** Identifies the document: collapsed headings are remembered per id, and a new id remounts the editor. */
  documentId?: string | null;
  /** Uploads pasted, dropped and picked images. Without it the image button is hidden and pasted files are left alone. */
  uploadImage?: UploadImage;
  /** Upload images already embedded as `data:` URIs and replace them. Only for users who can write. Default false. */
  convertEmbeddedImages?: boolean;
  onImageUploadError?: (error: unknown) => void;
  /** Called with the document's markdown after every change. */
  onMarkdownChange?: (markdown: string) => void;
  /** Called once the editor is bound and editable, and with `null` when it goes away. */
  onReady?: (api: EditorApi | null) => void;
  readOnly?: boolean;
  /** Focus the editor as soon as it can be typed into, unless the user is already somewhere else. */
  autoFocus?: boolean;
  /** UI strings; missing ones fall back to English. Use `esLabels` for Spanish. */
  labels?: Partial<EditorLabels>;
  /** Where preferences live (spellcheck, collapsed headings). Default `localStorage`. */
  storage?: EditorStorage;
  /** Prefix of every storage key. Default `tetsu-editor`. */
  storagePrefix?: string;
  /** Public URL of the dictionaries folder. Default `/editor-dictionaries`. */
  dictionaryBaseUrl?: string;
  /** A spellcheck controller to share, or `false` to turn spellcheck off. Default: the shared one for storage/prefix/URL. */
  spellcheck?: SpellcheckController | false;
  /** Show the formatting toolbar. Default true. */
  toolbar?: boolean;
  /** Shows an "Outline" toggle in the toolbar. */
  onOpenOutline?: () => void;
  outlineOpen?: boolean;
  /** Show the find bar above the document; it calls `onCloseSearch` to close. */
  searchOpen?: boolean;
  onCloseSearch?: () => void;
  /** The editor scrolls inside its own box instead of the page (fixed-height panels). */
  selfScroll?: boolean;
  /** CSS font-family for the document, e.g. `var(--font-serif)`. */
  fontFamily?: string;
  /** CSS font-size for the document body, e.g. `1.125rem`. */
  fontSize?: string;
  className?: string;
}

export type EditorShellProps = EditorBaseProps &
  (
    | { mode: 'collab'; doc: Y.Doc; awareness: Awareness; status: string; initialMarkdown?: string }
    | { mode: 'local'; initialMarkdown?: string }
  );

// Space between the caret and a bar that would cover it.
const CARET_GAP_PX = 12;

function cssVarPx(element: HTMLElement | null, name: string): number {
  if (!element) return 0;
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

export function EditorShell(props: EditorShellProps) {
  const {
    documentId = null,
    uploadImage,
    convertEmbeddedImages = false,
    onImageUploadError,
    onMarkdownChange,
    onReady,
    readOnly = false,
    autoFocus = false,
    labels: labelOverrides,
    storage = localStorageAdapter,
    storagePrefix = DEFAULT_STORAGE_PREFIX,
    dictionaryBaseUrl,
    spellcheck: givenSpellcheck,
    toolbar = true,
    onOpenOutline,
    outlineOpen,
    searchOpen = false,
    onCloseSearch,
    selfScroll = false,
    fontFamily,
    fontSize,
    className,
  } = props;
  const collab_ = props.mode === 'collab' ? props : null;
  const labels = resolveLabels(labelOverrides);

  const editableRef = useRef(false);
  const boundRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [openImage, setOpenImage] = useState<{ src: string; alt: string } | null>(null);

  // Read through refs at creation: useEditor's deps recreate the whole editor,
  // and a prop arriving one tick later must not cost a remount and the focus.
  const latest = useRef(props);
  latest.current = props;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const selfScrollRef = useRef(selfScroll);
  selfScrollRef.current = selfScroll;
  const spellcheckRef = useRef<SpellcheckController | false>(givenSpellcheck ?? getSpellcheck({ storage, storagePrefix, dictionaryBaseUrl }));
  spellcheckRef.current = givenSpellcheck ?? getSpellcheck({ storage, storagePrefix, dictionaryBaseUrl });
  const docListeners = useRef(new Set<(before: ProseNode, after: ProseNode) => void>());
  const applyingBridgeRef = useRef(false);

  // ProseMirror keeps the caret "in view" of the scrolling box, but a sticky
  // toolbar or header covers its edges. Getters: ProseMirror reads them only
  // when it scrolls, and the bars' heights change.
  const caretMargin = useMemo(
    () => ({
      get top() {
        return cssVarPx(rootRef.current, '--ted-header-height') + CARET_GAP_PX;
      },
      get bottom() {
        // With selfScroll the toolbar sits outside the scrolling box.
        return (selfScrollRef.current ? 0 : (toolbarRef.current?.offsetHeight ?? 0)) + CARET_GAP_PX;
      },
      left: 0,
      right: 0,
    }),
    [],
  );

  useEffect(() => setupBlockDragAutoScroll(() => rootRef.current), []);

  const deps = collab_ ? [collab_.doc, collab_.awareness, documentId] : [documentId];
  const { loading, get } = useEditor((root) => {
    editableRef.current = false;
    boundRef.current = false;
    const current = latest.current;
    const spellcheck = spellcheckRef.current;
    const isCollab = current.mode === 'collab';

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, isCollab ? '' : (current.initialMarkdown ?? ''));
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => editableRef.current && !readOnlyRef.current,
          // On mouse devices the plugin's popup replaces the native underline;
          // on touch the native checker stays as the only reliable one.
          attributes: { spellcheck: spellcheck && !isTouchDevice() ? 'false' : 'true' },
          scrollThreshold: caretMargin,
          scrollMargin: caretMargin,
        }));
        ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
          latest.current.onMarkdownChange?.(markdown);
        });
        configureBlockHandle(ctx, labelsRef.current);
        configureCodeBlock(ctx, labelsRef.current);
        configureListSpread(ctx);
        configureImageAttrs(ctx);
        ctx.update(prosePluginsCtx, (plugins) => {
          const extra: Plugin[] = [
            createHeadingAnchorsPlugin(),
            createHeadingCollapsePlugin({ documentId: current.documentId ?? null, storage: current.storage ?? localStorageAdapter, storagePrefix: current.storagePrefix ?? DEFAULT_STORAGE_PREFIX, labels: labelsRef.current }),
            createDropIndicatorPlugin(),
            searchPlugin(),
            createImageLightboxPlugin(setOpenImage),
            createImageLazyPlugin(),
            // Reports document changes to the plain-text bridge, except its own.
            new Plugin({
              view: () => ({
                update: (view, prev) => {
                  if (prev.doc === view.state.doc || applyingBridgeRef.current) return;
                  docListeners.current.forEach((listen) => listen(prev.doc, view.state.doc));
                },
              }),
            }),
          ];
          if (spellcheck) extra.push(createSpellcheckPlugin({ spellcheck, labels: labelsRef.current }));
          if (current.uploadImage) {
            extra.push(
              createImageUploadPlugin({
                uploadImage: (file) => {
                  const upload = latest.current.uploadImage;
                  return upload ? upload(file) : Promise.reject(new Error(labelsRef.current.imageUploadFailed));
                },
                canConvertEmbedded: () => Boolean(latest.current.convertEmbeddedImages) && !readOnlyRef.current,
                onUploading: setUploading,
                onError: (error) => {
                  latest.current.onImageUploadError?.(error);
                  setImageError(error instanceof Error && error.message ? error.message : labelsRef.current.imageUploadFailed);
                  setTimeout(() => setImageError(null), 5000);
                },
              }),
            );
          }
          return [...plugins, ...extra];
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(clipboard)
      .use(dropCursor)
      .use(indent)
      .use(trailing)
      .use(listener)
      .use(listItemView)
      .use(block)
      .use(codeBlockComponent);
    return isCollab ? editor.use(collab) : editor.use(history);
  }, deps);

  useEffect(() => {
    setConnected(false);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // Collaborative: bind the Y.Doc and awareness once the editor exists.
  useEffect(() => {
    if (!collab_ || loading || boundRef.current) return;
    const editor = get();
    if (!editor) return;
    editor.action((ctx) => {
      ctx.get(collabServiceCtx).bindDoc(collab_.doc).setAwareness(collab_.awareness);
    });
    boundRef.current = true;
  }, [loading, collab_?.doc, collab_?.awareness, get]); // eslint-disable-line react-hooks/exhaustive-deps

  // Becomes editable. Collaborative: only once the doc settled (synced, or
  // offline with local state as all there is), so seeding never races a
  // remote fetch. Two devices opening one brand-new document in the same
  // instant can both seed it (duplicated, not destructive): known limitation.
  const status = collab_?.status;
  useEffect(() => {
    if (loading || connected) return;
    const editor = get();
    if (!editor) return;
    if (props.mode === 'collab') {
      if (!boundRef.current) return;
      if (status !== 'synced' && status !== 'offline') return;
      editableRef.current = true;
      editor.action((ctx) => {
        const service = ctx.get(collabServiceCtx);
        service.applyTemplate(latest.current.initialMarkdown ?? '');
        service.connect();
      });
    } else {
      editableRef.current = true;
    }
    setConnected(true);
  }, [loading, status, connected, get, props.mode]);

  // `editable` is re-read on the next transaction; an empty one applies a readOnly change now.
  useEffect(() => {
    if (!connected) return;
    get()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view.isDestroyed) view.dispatch(view.state.tr);
    });
  }, [readOnly, connected, get]);

  const focusedRef = useRef(false);
  useEffect(() => {
    focusedRef.current = false;
  }, [documentId]);

  useEffect(() => {
    if (!autoFocus || !connected || readOnly || focusedRef.current) return;
    get()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view.isDestroyed) return;
      // If the user already went somewhere else, stealing focus is worse than none.
      const active = document.activeElement;
      if (active && active !== document.body && !view.dom.contains(active)) return;
      view.dispatch(view.state.tr);
      if (!view.editable) return;
      view.focus();
      focusedRef.current = true;
    });
  }, [autoFocus, connected, readOnly, get]);

  // The API, once connected (before, the document may be empty or half loaded).
  // `get` changes identity every render; read through a ref so the API (and a
  // plain-text editor built on it) is created once per connection.
  const getRef = useRef(get);
  getRef.current = get;
  useEffect(() => {
    if (!connected) return;
    const editor = getRef.current();
    if (!editor) return;
    let api: EditorApi | null = null;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = ctx.get(parserCtx);
      const serializer = ctx.get(serializerCtx);
      const listeners = docListeners.current;
      api = {
        editor,
        getDoc: () => view.state.doc,
        parse: (markdown) => parser(markdown),
        serialize: (doc) => serializer(doc),
        getMarkdown: () => serializer(view.state.doc),
        focus: () => view.focus(),
        replace: (replacements) => {
          if (view.isDestroyed) throw new Error('The visual editor no longer exists.');
          const tr = view.state.tr;
          for (const r of replacements) tr.replace(r.from, r.to, r.slice);
          applyingBridgeRef.current = true;
          try {
            view.dispatch(tr);
          } finally {
            applyingBridgeRef.current = false;
          }
        },
        onDocChange: (listen) => {
          listeners.add(listen);
          return () => {
            listeners.delete(listen);
          };
        },
      };
    });
    latest.current.onReady?.(api);
    return () => latest.current.onReady?.(null);
  }, [connected]);

  const style = {
    ...(fontFamily ? { '--ted-font-family': fontFamily } : {}),
    ...(fontSize ? { '--ted-font-size': fontSize } : {}),
  } as CSSProperties;

  return (
    <div ref={rootRef} className={`ted-editor${selfScroll ? ' ted-editor--self-scroll' : ''}${className ? ` ${className}` : ''}`} style={style}>
      {/* Above the document, not floating over it: it would cover the text being searched. */}
      {searchOpen && onCloseSearch && <SearchBar getEditor={get} onClose={onCloseSearch} labels={labels} />}
      <div className="ted-editor__body">
        <Milkdown />
      </div>
      {/* An upload takes a while: without this the editor looks frozen. */}
      {(uploading || imageError) && (
        <p className="ted-editor__status" data-error={imageError ? 'true' : undefined} role="status">
          {imageError ?? labels.uploadingImage}
        </p>
      )}
      {toolbar && (
        <div ref={toolbarRef} className="ted-editor__toolbar">
          <EditorToolbar
            getEditor={get}
            disabled={!connected || readOnly}
            history={props.mode === 'collab' ? 'yjs' : 'prosemirror'}
            uploadImage={uploadImage}
            onOpenOutline={onOpenOutline}
            outlineOpen={outlineOpen}
            labels={labels}
          />
        </div>
      )}
      {openImage && <ImageLightbox src={openImage.src} alt={openImage.alt} onClose={() => setOpenImage(null)} labels={labels} />}
    </div>
  );
}
