/**
 * Writing a file out, in whichever shell the app happens to be running in.
 *
 * In a browser this is an `<a download>` click. In the Tauri webview that does
 * nothing at all — the webview has no download manager — so the packaged app
 * has to go through the OS save dialog and a real filesystem write instead.
 */

/** True when running inside the Tauri webview rather than a browser tab. */
export function isTauri(): boolean {
  // Tauri v2 puts this on the window before any app code runs.
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type SaveOutcome = 'saved' | 'cancelled';

export interface SaveFileDeps {
  /** Opens the OS save dialog; resolves to the chosen path, or null if dismissed. */
  choosePath: (defaultName: string) => Promise<string | null>;
  /** Writes bytes to an absolute path. */
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Hands bytes to the browser as a download. */
  downloadInBrowser: (bytes: Uint8Array, name: string) => void;
  isTauri: () => boolean;
}

/** Lazily imported so a browser build never pulls the Tauri modules in. */
const defaultDeps: SaveFileDeps = {
  choosePath: async (defaultName) => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return save({
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  },
  writeFile: async (path, bytes) => {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, bytes);
  },
  downloadInBrowser: (bytes, name) => {
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
    } finally {
      // The click has already handed the blob to the browser; holding the URL
      // any longer just pins the bytes in memory.
      URL.revokeObjectURL(url);
    }
  },
  isTauri,
};

/**
 * Saves `bytes` as `suggestedName`.
 *
 * Returns `'cancelled'` only when the user dismissed a save dialog — a browser
 * download is fire-and-forget and always reports `'saved'`. Anything that
 * actually went wrong throws, so the caller can say so.
 */
export async function saveFile(
  bytes: Uint8Array,
  suggestedName: string,
  deps: SaveFileDeps = defaultDeps,
): Promise<SaveOutcome> {
  if (!deps.isTauri()) {
    deps.downloadInBrowser(bytes, suggestedName);
    return 'saved';
  }

  const path = await deps.choosePath(suggestedName);
  if (path === null) return 'cancelled';

  await deps.writeFile(path, bytes);
  return 'saved';
}
