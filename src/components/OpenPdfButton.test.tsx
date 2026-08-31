// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OpenPdfButton } from './OpenPdfButton';

afterEach(cleanup);

function pick(file: File): void {
  fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });
}

describe('OpenPdfButton', () => {
  it('hands the picked file to onOpen', () => {
    const onOpen = vi.fn();
    render(<OpenPdfButton onOpen={onOpen} />);

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'report.pdf', {
      type: 'application/pdf',
    });
    pick(file);

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(file);
  });

  it('reports an empty file instead of opening it', () => {
    const onOpen = vi.fn();
    const onError = vi.fn();
    render(<OpenPdfButton onOpen={onOpen} onError={onError} />);

    pick(new File([], 'empty.pdf', { type: 'application/pdf' }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('empty.pdf is empty.');
  });

  it('clears the input so re-picking the same file fires again', () => {
    render(<OpenPdfButton onOpen={vi.fn()} />);
    const input = screen.getByTestId<HTMLInputElement>('file-input');

    pick(new File(['%PDF-'], 'report.pdf', { type: 'application/pdf' }));

    expect(input.value).toBe('');
  });

  it('restricts the picker to PDFs', () => {
    render(<OpenPdfButton onOpen={vi.fn()} />);

    expect(screen.getByTestId('file-input').getAttribute('accept')).toBe('application/pdf,.pdf');
  });
});
