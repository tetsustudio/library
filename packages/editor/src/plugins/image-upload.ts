import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

export const imageUploadKey = new PluginKey('ted-image-upload');

/** What the app's upload returns: the public URL to put in the markdown, and optionally its alt text. */
export interface UploadedImage {
  url: string;
  alt?: string;
}

/** Uploads one image file (to S3, Supabase Storage, your API...) and resolves with its URL. Throw to report an error. */
export type UploadImage = (file: File) => Promise<UploadedImage>;

export interface ImageUploadOptions {
  uploadImage: UploadImage;
  /**
   * Whether images already embedded as `data:` URIs may be uploaded and
   * replaced. Only for users who can write the document: for a reader the
   * upload would succeed and the change would then be rejected, leaving
   * orphan files. Default: never.
   */
  canConvertEmbedded?: () => boolean;
  /** True while at least one upload is in flight. */
  onUploading?: (uploading: boolean) => void;
  onError?: (error: unknown) => void;
  /** Delay before scanning the document again for embedded images. Default 500 ms. */
  convertDelayMs?: number;
}

function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

// Looks the node up again instead of keeping its old position: seconds of
// typing (local or remote) may have passed while the file uploaded.
function replaceSrc(view: EditorView, oldSrc: string, newSrc: string): void {
  // Dispatching on a destroyed Milkdown editor throws "Context 'editorState' not found".
  if (view.isDestroyed) return;
  let found: { pos: number; node: ProseNode } | null = null;
  view.state.doc.descendants((child, pos) => {
    if (found) return false;
    if (child.type.name === 'image' && child.attrs.src === oldSrc) found = { pos, node: child };
    return true;
  });
  if (!found) return;
  const { pos, node } = found as { pos: number; node: ProseNode };
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newSrc }));
}

async function fileFromDataUri(src: string): Promise<File> {
  // fetch() resolves data: URIs without the network and parses the base64.
  const blob = await fetch(src).then((r) => r.blob());
  const extension = (blob.type.split('/')[1] ?? 'png').replace('+xml', '');
  return new File([blob], `pasted.${extension}`, { type: blob.type });
}

/**
 * Every image that enters the document goes through `uploadImage`; none stays
 * embedded as base64 (which would bloat the markdown and every CRDT update
 * that touches its paragraph).
 *
 * 1. Pasted or dropped files are uploaded and inserted as links.
 * 2. Images that arrive already embedded (HTML pasted from Word or Google
 *    Docs, old documents) are uploaded and their `src` replaced in place,
 *    when `canConvertEmbedded()` allows it.
 */
export function createImageUploadPlugin(options: ImageUploadOptions): Plugin {
  const inFlight = new Set<string>();
  let uploading = 0;
  const mark = (delta: number) => {
    uploading += delta;
    options.onUploading?.(uploading > 0);
  };

  async function upload(file: File): Promise<UploadedImage | null> {
    mark(1);
    try {
      return await options.uploadImage(file);
    } catch (error) {
      options.onError?.(error);
      return null;
    } finally {
      mark(-1);
    }
  }

  async function insertFiles(view: EditorView, files: File[], position?: number) {
    for (const file of files) {
      const uploaded = await upload(file);
      if (!uploaded) continue;
      if (view.isDestroyed) return;
      const type = view.state.schema.nodes.image;
      if (!type) return;
      const node = type.create({ src: uploaded.url, alt: uploaded.alt ?? file.name });
      // Clamped: the document may have shrunk while the file uploaded.
      const at = Math.min(position ?? view.state.selection.from, view.state.doc.content.size);
      view.dispatch(view.state.tr.insert(at, node));
    }
  }

  // Two clients may convert the same image at once: both upload and the last
  // write wins. Not destructive (one orphan file), and accepted.
  function convertEmbedded(view: EditorView) {
    if (!options.canConvertEmbedded?.()) return;
    view.state.doc.descendants((node) => {
      const src = node.type.name === 'image' ? (node.attrs.src as string | null) : null;
      if (!src || !src.startsWith('data:image/') || inFlight.has(src)) return true;
      inFlight.add(src);
      void fileFromDataUri(src)
        .then((file) => upload(file))
        .then((uploaded) => {
          if (uploaded) replaceSrc(view, src, uploaded.url);
        })
        .catch(() => {
          // One failure never stops the rest.
        });
      return true;
    });
  }

  return new Plugin({
    key: imageUploadKey,
    view: (initial) => {
      convertEmbedded(initial);
      let timer: ReturnType<typeof setTimeout> | null = null;
      return {
        // update() runs on every transaction (every key) and the scan walks
        // the whole document: skip non-doc changes and batch the rest.
        update: (view, prevState) => {
          if (view.state.doc === prevState.doc) return;
          if (timer != null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            convertEmbedded(view);
          }, options.convertDelayMs ?? 500);
        },
        destroy: () => {
          if (timer != null) clearTimeout(timer);
        },
      };
    },
    props: {
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertFiles(view, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        // `moved` is a block of this document being dragged: nothing to upload.
        if (moved) return false;
        const files = imageFiles(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void insertFiles(view, files, target?.pos);
        return true;
      },
    },
  });
}
