import { describe, expect, it, vi } from 'vitest';
import { saveFile, type SaveFileDeps } from './save-file';

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function deps(overrides: Partial<SaveFileDeps> = {}): SaveFileDeps {
  return {
    choosePath: vi.fn(() => Promise.resolve('/home/someone/report.pdf')),
    writeFile: vi.fn(() => Promise.resolve()),
    downloadInBrowser: vi.fn(),
    isTauri: () => false,
    ...overrides,
  };
}

describe('saveFile in a browser', () => {
  it('hands the bytes to the browser as a download', async () => {
    const d = deps();

    await expect(saveFile(BYTES, 'report.pdf', d)).resolves.toBe('saved');
    expect(d.downloadInBrowser).toHaveBeenCalledWith(BYTES, 'report.pdf');
  });

  it('does not open a save dialog there is no shell for', async () => {
    const d = deps();

    await saveFile(BYTES, 'report.pdf', d);

    expect(d.choosePath).not.toHaveBeenCalled();
    expect(d.writeFile).not.toHaveBeenCalled();
  });
});

describe('saveFile in the Tauri webview', () => {
  // The webview has no download manager: `<a download>` does nothing at all, so
  // the packaged app has to write the file itself.
  const inTauri = (overrides: Partial<SaveFileDeps> = {}): SaveFileDeps =>
    deps({ isTauri: () => true, ...overrides });

  it('asks the user where to put the file, then writes it', async () => {
    const d = inTauri();

    await expect(saveFile(BYTES, 'report.pdf', d)).resolves.toBe('saved');
    expect(d.choosePath).toHaveBeenCalledWith('report.pdf');
    expect(d.writeFile).toHaveBeenCalledWith('/home/someone/report.pdf', BYTES);
  });

  it('never falls back to a download that would silently do nothing', async () => {
    const d = inTauri();

    await saveFile(BYTES, 'report.pdf', d);

    expect(d.downloadInBrowser).not.toHaveBeenCalled();
  });

  it('writes nothing when the dialog is dismissed', async () => {
    const d = inTauri({ choosePath: vi.fn(() => Promise.resolve(null)) });

    await expect(saveFile(BYTES, 'report.pdf', d)).resolves.toBe('cancelled');
    expect(d.writeFile).not.toHaveBeenCalled();
  });

  it('reports a failed write rather than claiming success', async () => {
    const d = inTauri({ writeFile: vi.fn(() => Promise.reject(new Error('permission denied'))) });

    await expect(saveFile(BYTES, 'report.pdf', d)).rejects.toThrow('permission denied');
  });
});
