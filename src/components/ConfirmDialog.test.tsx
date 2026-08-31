// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

afterEach(cleanup);

function renderDialog(overrides: Partial<ConfirmDialogProps> = {}): ConfirmDialogProps {
  const props: ConfirmDialogProps = {
    title: 'Close without saving?',
    message: 'This document has changes that have not been written to a file.',
    confirmLabel: 'Close without saving',
    saveLabel: 'Save as…',
    onConfirm: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ConfirmDialog {...props} />);
  return props;
}

describe('ConfirmDialog', () => {
  it('offers all three ways out', () => {
    renderDialog();

    // Being forced to choose between losing work and abandoning the action is
    // the thing this dialog exists to avoid.
    expect(screen.getByTestId('confirm-cancel')).toBeTruthy();
    expect(screen.getByTestId('confirm-save')).toBeTruthy();
    expect(screen.getByTestId('confirm-discard')).toBeTruthy();
  });

  it('starts focused on the safe option', () => {
    renderDialog();

    // A stray Return must not discard the document.
    expect(window.document.activeElement).toBe(screen.getByTestId('confirm-cancel'));
  });

  it('reports each choice separately', () => {
    const { onConfirm, onSave, onCancel } = renderDialog();

    fireEvent.click(screen.getByTestId('confirm-discard'));
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('confirm-save'));
    expect(onSave).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('confirm-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on Escape', () => {
    const { onCancel } = renderDialog();

    fireEvent.keyDown(screen.getByTestId('confirm-dialog'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('omits the save option when there is nowhere to save to', () => {
    render(
      <ConfirmDialog
        title="Close without saving?"
        message="Changes will be lost."
        confirmLabel="Close without saving"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('confirm-save')).toBeNull();
  });

  it('announces itself as a modal alert', () => {
    renderDialog();

    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
