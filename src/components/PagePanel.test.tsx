// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PagePanel, type PagePanelProps } from './PagePanel';

afterEach(cleanup);

function renderPanel(overrides: Partial<PagePanelProps> = {}): PagePanelProps {
  const props: PagePanelProps = {
    rotations: [0, 0, 0],
    selected: new Set<number>(),
    busy: false,
    error: null,
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onRotate: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    onExtract: vi.fn(),
    onMerge: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<PagePanel {...props} />);
  return props;
}

function button(id: string): HTMLButtonElement {
  return screen.getByTestId<HTMLButtonElement>(id);
}

describe('PagePanel', () => {
  it('lists a row per page', () => {
    renderPanel({ rotations: [0, 0, 0, 0] });

    expect(screen.getByTestId('pages-list').children).toHaveLength(4);
  });

  it('shows the rotation a page already carries', () => {
    renderPanel({ rotations: [0, 90, 0] });

    expect(screen.getByTestId('page-1-rotation').textContent).toBe('90°');
    // An upright page says nothing rather than "0°", which is noise.
    expect(screen.queryByTestId('page-0-rotation')).toBeNull();
  });

  it('reports which page was ticked', () => {
    const { onToggle } = renderPanel();

    fireEvent.click(screen.getByTestId('page-2'));

    expect(onToggle).toHaveBeenCalledWith(2);
  });
});

describe('PagePanel with nothing selected', () => {
  // Applying an operation to the whole document because nothing was ticked is
  // far more likely to be a mis-click than an intention.
  it('offers no operation that needs a selection', () => {
    renderPanel();

    expect(button('pages-rotate-left').disabled).toBe(true);
    expect(button('pages-rotate-right').disabled).toBe(true);
    expect(button('pages-delete').disabled).toBe(true);
    expect(button('pages-extract').disabled).toBe(true);
  });

  it('still allows merging, which needs no selection', () => {
    renderPanel();

    expect(button('pages-merge').disabled).toBe(false);
  });
});

describe('PagePanel selection-dependent actions', () => {
  it('rotates in both directions', () => {
    const { onRotate } = renderPanel({ selected: new Set([0]) });

    fireEvent.click(button('pages-rotate-right'));
    fireEvent.click(button('pages-rotate-left'));

    expect(onRotate).toHaveBeenNthCalledWith(1, 90);
    expect(onRotate).toHaveBeenNthCalledWith(2, 270);
  });

  it('moves only a single page, since moving a scattered set has no meaning', () => {
    renderPanel({ selected: new Set([0, 2]), rotations: [0, 0, 0] });

    expect(button('pages-move-up').disabled).toBe(true);
    expect(button('pages-move-down').disabled).toBe(true);
  });

  it('cannot move the first page earlier or the last page later', () => {
    renderPanel({ selected: new Set([0]), rotations: [0, 0, 0] });
    expect(button('pages-move-up').disabled).toBe(true);
    expect(button('pages-move-down').disabled).toBe(false);

    cleanup();

    renderPanel({ selected: new Set([2]), rotations: [0, 0, 0] });
    expect(button('pages-move-up').disabled).toBe(false);
    expect(button('pages-move-down').disabled).toBe(true);
  });

  it('refuses to delete every page', () => {
    // The library rejects this too; the button should not invite it.
    renderPanel({ selected: new Set([0, 1, 2]), rotations: [0, 0, 0] });

    expect(button('pages-delete').disabled).toBe(true);
  });

  it('allows deleting some of the pages', () => {
    renderPanel({ selected: new Set([0, 1]), rotations: [0, 0, 0] });

    expect(button('pages-delete').disabled).toBe(false);
  });
});

describe('PagePanel while an operation runs', () => {
  it('locks every action, so a second click cannot race the first', () => {
    renderPanel({ selected: new Set([0]), busy: true });

    for (const id of ['pages-rotate-left', 'pages-rotate-right', 'pages-delete', 'pages-extract', 'pages-merge']) {
      expect(button(id).disabled).toBe(true);
    }
    expect(screen.getByTestId<HTMLInputElement>('page-0').disabled).toBe(true);
  });
});

describe('PagePanel errors', () => {
  it('shows a failure as an alert', () => {
    renderPanel({ error: 'remove: a document must keep at least one page' });

    const alert = screen.getByTestId('pages-error');
    expect(alert.textContent).toMatch(/at least one page/);
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('shows nothing when there is no error', () => {
    renderPanel();

    expect(screen.queryByTestId('pages-error')).toBeNull();
  });
});
