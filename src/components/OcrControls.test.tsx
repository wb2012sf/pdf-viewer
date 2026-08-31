// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OcrControls, type OcrControlsProps } from './OcrControls';

afterEach(cleanup);

function renderControls(overrides: Partial<OcrControlsProps> = {}) {
  const props: OcrControlsProps = {
    status: 'idle',
    progress: null,
    wordsAdded: null,
    error: null,
    ready: true,
    onRun: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<OcrControls {...props} />);
  return props;
}

describe('OcrControls', () => {
  it('runs OCR when the button is pressed', () => {
    const { onRun } = renderControls();

    fireEvent.click(screen.getByTestId('ocr-run'));

    expect(onRun).toHaveBeenCalledOnce();
  });

  it('cannot be run before the viewer hands over its engine', () => {
    renderControls({ ready: false });

    expect(screen.getByTestId<HTMLButtonElement>('ocr-run').disabled).toBe(true);
  });

  it('names the stage and the page it is on', () => {
    // One opaque percentage would hide that rendering and recognizing are
    // paced very differently.
    renderControls({ status: 'running', progress: { stage: 'recognizing', completed: 3, total: 8 } });

    expect(screen.getByTestId('ocr-progress').textContent).toBe('Reading text 3/8');
  });

  it('does not show a page count for the single-shot write step', () => {
    renderControls({ status: 'running', progress: { stage: 'writing', completed: 0, total: 1 } });

    expect(screen.getByTestId('ocr-progress').textContent).toBe('Saving text layer…');
  });

  it('offers a way out of a long run', () => {
    const { onCancel } = renderControls({ status: 'running', progress: null });

    fireEvent.click(screen.getByTestId('ocr-cancel'));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('hides the run button while a run is in flight', () => {
    renderControls({ status: 'running', progress: null });

    expect(screen.queryByTestId('ocr-run')).toBeNull();
  });

  it('reports how much text it found', () => {
    renderControls({ status: 'done', wordsAdded: 412 });

    expect(screen.getByTestId('ocr-done').textContent).toBe('Added 412 searchable words');
  });

  it('says something useful when a page yielded nothing', () => {
    // Zero words is the common "this PDF already has text, or the scan is
    // unreadable" case, and a bare "Added 0 words" explains nothing.
    renderControls({ status: 'done', wordsAdded: 0 });

    expect(screen.getByTestId('ocr-done').textContent).toBe('No text found — is this page a scan?');
  });

  it('agrees with itself about singular and plural', () => {
    renderControls({ status: 'done', wordsAdded: 1 });

    expect(screen.getByTestId('ocr-done').textContent).toBe('Added 1 searchable word');
  });

  it('surfaces a failure as an alert rather than swallowing it', () => {
    renderControls({ status: 'error', error: 'document: this PDF is password-protected' });

    const alert = screen.getByTestId('ocr-error');
    expect(alert.textContent).toBe('document: this PDF is password-protected');
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('lets a finished run be repeated', () => {
    renderControls({ status: 'done', wordsAdded: 5 });

    expect(screen.getByTestId('ocr-run').textContent).toBe('Run OCR again');
  });
});
