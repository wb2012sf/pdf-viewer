import { useCallback, useRef, useState } from 'react';
import type { PdfEngine } from '@embedpdf/models';
import { makeSearchable, type MakeSearchableOptions, type OcrProgress } from '../lib/ocr';

export type OcrStatus = 'idle' | 'running' | 'done' | 'error';

export interface OcrState {
  status: OcrStatus;
  progress: OcrProgress | null;
  /** Words written into the document by the last successful run. */
  wordsAdded: number | null;
  error: string | null;
}

const IDLE: OcrState = { status: 'idle', progress: null, wordsAdded: null, error: null };

export interface UseOcrResult extends OcrState {
  /** Resolves with the searchable PDF, or null if the run failed or was cancelled. */
  run: (engine: PdfEngine, pdfBytes: Uint8Array, options?: MakeSearchableOptions) => Promise<Uint8Array | null>;
  cancel: () => void;
  reset: () => void;
}

/**
 * Drives an OCR run for the UI.
 *
 * Errors are surfaced as a message rather than thrown: OCR failing on one file
 * should not tear down the viewer that is still happily showing it.
 */
export function useOcr(): UseOcrResult {
  const [state, setState] = useState<OcrState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (
      engine: PdfEngine,
      pdfBytes: Uint8Array,
      options: MakeSearchableOptions = {},
    ): Promise<Uint8Array | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ status: 'running', progress: null, wordsAdded: null, error: null });

      try {
        const result = await makeSearchable(engine, pdfBytes, {
          ...options,
          signal: controller.signal,
          onProgress: (progress) => {
            // A run superseded by a newer one must stop painting over it.
            if (!controller.signal.aborted) setState((prev) => ({ ...prev, progress }));
          },
        });

        if (controller.signal.aborted) return null;
        setState({ status: 'done', progress: null, wordsAdded: result.wordsAdded, error: null });
        return result.pdf;
      } catch (cause) {
        if (controller.signal.aborted) {
          setState(IDLE);
          return null;
        }
        setState({
          status: 'error',
          progress: null,
          wordsAdded: null,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [],
  );

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  const reset = useCallback((): void => {
    setState(IDLE);
  }, []);

  return { ...state, run, cancel, reset };
}
