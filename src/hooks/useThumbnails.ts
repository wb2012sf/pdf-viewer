import { useEffect, useRef, useState } from 'react';
import type { PdfEngine } from '@embedpdf/models';
import { renderThumbnails, revokeThumbnails, type Thumbnail } from '../lib/pdf/thumbnails';

export interface ThumbnailsState {
  thumbnails: readonly Thumbnail[];
  /** True while newer thumbnails are rendering and these are the previous ones. */
  stale: boolean;
}

interface Rendered {
  /** The bytes these thumbnails were rendered from, for comparison. */
  source: Uint8Array | null;
  thumbnails: readonly Thumbnail[];
}

/**
 * Page previews for the document, kept on screen across an edit.
 *
 * Every page operation rewrites the document, which used to empty the panel
 * until the new previews finished rendering — the list collapsed, the scroll
 * position was lost, and the panel looked broken at exactly the moment the user
 * wanted to see what their edit did.
 *
 * So the previous thumbnails stay in place until the new set is ready to
 * replace them wholesale. The list never empties, so it never collapses, and
 * its scroll position survives on its own.
 */
export function useThumbnails(engine: PdfEngine | null, pdfBytes: Uint8Array | null): ThumbnailsState {
  const [rendered, setRendered] = useState<Rendered>({ source: null, thumbnails: [] });

  // Held in a ref so the cleanup below can revoke whatever is on screen without
  // making every render re-run the effect.
  const showing = useRef<readonly Thumbnail[]>([]);

  useEffect(() => {
    // The engine goes away for a moment every time the document is replaced —
    // the viewer is remounted and hands back a new one. That is not a reason to
    // throw the previews away: only the document actually closing is. Without
    // this the panel blanks on every single page operation.
    if (!engine && pdfBytes) return;

    const controller = new AbortController();
    const rendering =
      engine && pdfBytes
        ? renderThumbnails(engine, pdfBytes, { signal: controller.signal })
        : Promise.resolve<Thumbnail[]>([]);

    void rendering
      .then((next) => {
        if (controller.signal.aborted) {
          revokeThumbnails(next);
          return;
        }
        revokeThumbnails(showing.current);
        showing.current = next;
        setRendered({ source: pdfBytes, thumbnails: next });
      })
      .catch(() => {
        // A document the engine cannot render: keep whatever is showing rather
        // than blanking the panel, but stop calling it stale — nothing better
        // is coming.
        if (!controller.signal.aborted) setRendered((prev) => ({ ...prev, source: pdfBytes }));
      });

    return () => {
      controller.abort();
    };
  }, [engine, pdfBytes]);

  // Release the last set when the panel goes away for good.
  useEffect(
    () => () => {
      revokeThumbnails(showing.current);
      showing.current = [];
    },
    [],
  );

  // Derived rather than stored, so the effect never has to set state
  // synchronously: what is on screen is stale exactly when it came from
  // different bytes than the ones now open.
  return {
    thumbnails: rendered.thumbnails,
    stale: rendered.source !== pdfBytes && rendered.thumbnails.length > 0,
  };
}
