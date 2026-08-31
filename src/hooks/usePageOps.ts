import { useCallback, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { currentDocumentBytes } from '../lib/viewer/current-document';

/** A page operation: given the document as it stands, produce the new one. */
export type PageOperation = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface PageOpsState {
  busy: boolean;
  error: string | null;
}

export interface UsePageOpsResult extends PageOpsState {
  /** Resolves with the rewritten document, or null if it failed. */
  apply: (registry: PluginRegistry, operation: PageOperation) => Promise<Uint8Array | null>;
  clearError: () => void;
}

/**
 * Runs a page operation against the document the viewer currently holds.
 *
 * Reading goes through `currentDocumentBytes` for the same reason Save and OCR
 * do: anything annotated since the file was opened lives in the viewer's state,
 * and reordering the bytes it arrived as would throw that away.
 *
 * Failures become a message rather than an exception — a rejected rotation
 * should not take down the viewer that is still showing the document.
 */
export function usePageOps(): UsePageOpsResult {
  const [state, setState] = useState<PageOpsState>({ busy: false, error: null });

  const apply = useCallback(
    async (registry: PluginRegistry, operation: PageOperation): Promise<Uint8Array | null> => {
      setState({ busy: true, error: null });
      try {
        const result = await operation(await currentDocumentBytes(registry));
        setState({ busy: false, error: null });
        return result;
      } catch (cause) {
        setState({ busy: false, error: cause instanceof Error ? cause.message : String(cause) });
        return null;
      }
    },
    [],
  );

  const clearError = useCallback((): void => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return { ...state, apply, clearError };
}
