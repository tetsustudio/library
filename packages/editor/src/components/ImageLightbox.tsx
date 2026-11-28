'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { resolveLabels, type EditorLabels } from '../labels.js';
import { Icon } from './icons.js';

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const BUTTON_STEP = 1.4;

interface ViewState {
  scale: number;
  x: number;
  y: number;
}

const INITIAL: ViewState = { scale: 1, x: 0, y: 0 };

export interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
  labels?: Partial<EditorLabels>;
}

/**
 * A document image full screen, with zoom: wheel, double click, buttons, drag
 * to pan and pinch. Pointer Events cover mouse and touch with one code path;
 * a pinch is two active pointers.
 */
export function ImageLightbox({ src, alt, onClose, labels: labelOverrides }: ImageLightboxProps) {
  const labels = resolveLabels(labelOverrides);
  const [view, setView] = useState<ViewState>(INITIAL);
  const containerRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const clamp = useCallback((next: ViewState): ViewState => {
    const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next.scale));
    if (scale === 1) return { scale, x: 0, y: 0 };
    // Panning is limited to how far the zoomed image overflows.
    const box = containerRef.current?.getBoundingClientRect();
    const maxX = box ? (box.width * (scale - 1)) / 2 : Infinity;
    const maxY = box ? (box.height * (scale - 1)) / 2 : Infinity;
    return { scale, x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  }, []);

  // Zooms toward a point (the cursor, the middle of a pinch), not the center.
  const zoomTo = useCallback(
    (nextScale: number, clientX?: number, clientY?: number) => {
      setView((previous) => {
        const box = containerRef.current?.getBoundingClientRect();
        const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale));
        if (!box || clientX === undefined || clientY === undefined) return clamp({ ...previous, scale });
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        const factor = scale / previous.scale;
        return clamp({
          scale,
          x: clientX - centerX - (clientX - centerX - previous.x) * factor,
          y: clientY - centerY - (clientY - centerY - previous.y) * factor,
        });
      });
    },
    [clamp],
  );

  const onPointerDown = (event: ReactPointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values()) as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = Array.from(pointers.current.values()) as [{ x: number; y: number }, { x: number; y: number }];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.distance > 0) zoomTo((pinch.current.scale * distance) / pinch.current.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (view.scale === 1) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    setView((current) => clamp({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  return (
    <div className="ted-lightbox" role="dialog" aria-modal="true" aria-label={alt || labels.image}>
      <div className="ted-lightbox__bar">
        <p className="ted-lightbox__caption">{alt}</p>
        <LightboxButton label={labels.zoomOut} onClick={() => zoomTo(view.scale / BUTTON_STEP)}>
          <Icon name="minus" />
        </LightboxButton>
        <LightboxButton label={labels.zoomIn} onClick={() => zoomTo(view.scale * BUTTON_STEP)}>
          <Icon name="plus" />
        </LightboxButton>
        <LightboxButton label={labels.resetZoom} onClick={() => setView(INITIAL)}>
          <Icon name="rotateCcw" />
        </LightboxButton>
        <LightboxButton label={labels.close} onClick={onClose}>
          <Icon name="x" />
        </LightboxButton>
      </div>
      <div
        ref={containerRef}
        className="ted-lightbox__stage"
        // Without touch-action none the browser keeps the gesture and the pinch never arrives.
        style={{ touchAction: 'none', cursor: view.scale > 1 ? 'grab' : 'zoom-in' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(event) => zoomTo(view.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY)}
        onDoubleClick={(event) => {
          if (view.scale > 1) setView(INITIAL);
          else zoomTo(2.5, event.clientX, event.clientY);
        }}
        onClick={(event) => {
          // A click on the backdrop closes; on the image it does not.
          if (event.target === event.currentTarget && view.scale === 1) onClose();
        }}
      >
        <img
          src={src}
          alt={alt ?? ''}
          draggable={false}
          className="ted-lightbox__image"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            // No transition while a finger or the mouse drives it.
            transition: pointers.current.size > 0 ? 'none' : 'transform 120ms ease-out',
          }}
        />
      </div>
    </div>
  );
}

function LightboxButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="ted-lightbox__button">
      {children}
    </button>
  );
}
