// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DropZone } from './DropZone';

afterEach(cleanup);

function pdf(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
}

function dropOf(files: File[]) {
  return { dataTransfer: { types: ['Files'], files, dropEffect: '' } };
}

describe('DropZone', () => {
  it('hands over the PDFs that were dropped', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles}>content</DropZone>);

    fireEvent.drop(screen.getByTestId('dropzone'), dropOf([pdf('a.pdf'), pdf('b.pdf')]));

    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.pdf' }), expect.objectContaining({ name: 'b.pdf' })]);
  });

  it('rejects a file that is not a PDF', () => {
    // A picker's `accept` filter does not apply to a drop, so this is the only
    // thing between a dropped .docx and a confusing parse error.
    const onFiles = vi.fn();
    const onReject = vi.fn();
    render(<DropZone onFiles={onFiles} onReject={onReject}>content</DropZone>);

    const notPdf = new File(['x'], 'notes.docx', { type: 'application/msword' });
    fireEvent.drop(screen.getByTestId('dropzone'), dropOf([notPdf]));

    expect(onFiles).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalled();
  });

  it('keeps the PDFs out of a mixed drop', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles}>content</DropZone>);

    const notPdf = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(screen.getByTestId('dropzone'), dropOf([notPdf, pdf('good.pdf')]));

    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'good.pdf' })]);
  });

  it('shows where the files will land while one is over it', () => {
    render(<DropZone onFiles={vi.fn()}>content</DropZone>);
    const zone = screen.getByTestId('dropzone');

    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });

    expect(zone.getAttribute('data-over')).toBe('true');
    expect(screen.getByTestId('dropzone-hint')).toBeTruthy();
  });

  it('stops showing it once the drop has happened', () => {
    render(<DropZone onFiles={vi.fn()}>content</DropZone>);
    const zone = screen.getByTestId('dropzone');

    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    fireEvent.drop(zone, dropOf([pdf('a.pdf')]));

    expect(zone.getAttribute('data-over')).toBe('false');
  });

  it('ignores a drag that carries no files', () => {
    // Dragging selected text across the window should not offer to open it.
    render(<DropZone onFiles={vi.fn()}>content</DropZone>);
    const zone = screen.getByTestId('dropzone');

    fireEvent.dragEnter(zone, { dataTransfer: { types: ['text/plain'] } });

    expect(zone.getAttribute('data-over')).toBe('false');
  });
});
