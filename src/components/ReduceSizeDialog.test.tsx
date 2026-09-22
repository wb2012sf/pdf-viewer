// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReduceSizeDialog, type ReduceSizeDialogProps } from './ReduceSizeDialog';
import { DEFAULT_PRESET_ID, SIZE_PRESETS } from './reduce-size-presets';

afterEach(cleanup);

function renderDialog(overrides: Partial<ReduceSizeDialogProps> = {}): ReduceSizeDialogProps {
  const props: ReduceSizeDialogProps = {
    busy: false,
    progress: null,
    error: null,
    onReduce: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ReduceSizeDialog {...props} />);
  return props;
}

describe('ReduceSizeDialog', () => {
  it('offers every preset, with the resolution each one means', () => {
    renderDialog();

    for (const preset of SIZE_PRESETS) {
      const radio = screen.getByTestId(`reduce-preset-${preset.id}`);
      expect(radio).toBeTruthy();
      expect(screen.getByText(`${String(preset.dpi)} DPI`)).toBeTruthy();
    }
  });

  it('starts on the balanced preset rather than the most destructive one', () => {
    renderDialog();

    expect(screen.getByTestId<HTMLInputElement>(`reduce-preset-${DEFAULT_PRESET_ID}`).checked).toBe(true);
  });

  it('reduces at the preset that was picked', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByTestId('reduce-preset-screen'));
    fireEvent.click(screen.getByTestId('reduce-confirm'));

    expect(props.onReduce).toHaveBeenCalledWith(SIZE_PRESETS[0]);
  });

  it('defaults to the balanced preset when nothing is touched', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByTestId('reduce-confirm'));

    expect(props.onReduce).toHaveBeenCalledWith(
      SIZE_PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID),
    );
  });

  it('locks the choice and both buttons while it runs', () => {
    renderDialog({ busy: true });

    expect(screen.getByTestId<HTMLButtonElement>('reduce-confirm').disabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>('reduce-cancel').disabled).toBe(true);
    // A disabled fieldset disables the radios inside it; the property only
    // reflects an element's own attribute, so the fieldset is what to ask.
    expect(screen.getByTestId<HTMLFieldSetElement>('reduce-presets').disabled).toBe(true);
  });

  it('says which image it is on, so a long run does not look stalled', () => {
    renderDialog({ busy: true, progress: { completed: 3, total: 12 } });

    expect(screen.getByTestId('reduce-progress').textContent).toContain('3 of 12');
  });

  it('cancels on Escape, but not while it is rewriting the document', () => {
    const props = renderDialog();
    fireEvent.keyDown(screen.getByTestId('reduce-dialog'), { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    const busyProps = renderDialog({ busy: true });
    fireEvent.keyDown(screen.getByTestId('reduce-dialog'), { key: 'Escape' });
    expect(busyProps.onCancel).not.toHaveBeenCalled();
  });

  it('shows a failure in the dialog rather than closing it', () => {
    renderDialog({ error: 'document: this PDF is password-protected' });

    expect(screen.getByTestId('reduce-error').textContent).toContain('password-protected');
  });
});
