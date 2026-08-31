import { describe, expect, it, vi } from 'vitest';
import type { PluginRegistry } from '@embedpdf/core';
import { currentDocumentBytes } from './current-document';

/** A registry that hands back whatever export plugin the test wants — or none. */
function registryWith(exporter: unknown): PluginRegistry {
  return {
    getPlugin: (id: string) => (id === 'export' ? exporter : null),
  } as unknown as PluginRegistry;
}

function exporterReturning(buffer: ArrayBuffer) {
  return {
    provides: () => ({
      saveAsCopy: () => ({ toPromise: () => Promise.resolve(buffer) }),
    }),
  };
}

describe('currentDocumentBytes', () => {
  it('returns the document the viewer currently holds', async () => {
    const source = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    const bytes = await currentDocumentBytes(registryWith(exporterReturning(source.buffer)));

    expect(Array.from(bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('explains itself in words a user can act on when export is unavailable', async () => {
    // The message reaches the toolbar verbatim, so it must not name internals.
    await expect(currentDocumentBytes(registryWith(null))).rejects.toThrow(
      /Could not read the document back from the viewer/,
    );
  });

  it('fails rather than falling back to something stale', async () => {
    // Silently returning the bytes the file was opened with would hand back a
    // copy missing everything the user had just done.
    await expect(currentDocumentBytes(registryWith(undefined))).rejects.toBeInstanceOf(Error);
  });

  it('propagates a failure from the export itself', async () => {
    const failing = {
      provides: () => ({
        saveAsCopy: () => ({ toPromise: () => Promise.reject(new Error('export task failed')) }),
      }),
    };

    await expect(currentDocumentBytes(registryWith(failing))).rejects.toThrow('export task failed');
  });

  it('asks the registry for the export plugin by name', async () => {
    const getPlugin = vi.fn(() => exporterReturning(new Uint8Array([1]).buffer));
    const registry = { getPlugin } as unknown as PluginRegistry;

    await currentDocumentBytes(registry);

    expect(getPlugin).toHaveBeenCalledWith('export');
  });
});
