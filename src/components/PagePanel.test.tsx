// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PagePanel, type PagePanelProps } from './PagePanel';

afterEach(cleanup);

function thumbsFor(count: number) {
  return Array.from({ length: count }, (_unused, pageIndex) => ({
    pageIndex,
    url: `blob:thumb-${String(pageIndex)}`,
    width: 60,
    height: 80,
  }));
}

function renderPanel(overrides: Partial<PagePanelProps> = {}): PagePanelProps {
  const props: PagePanelProps = {
    rotations: [0, 0, 0],
    turnedBy: [0, 0, 0],
    thumbnails: thumbsFor(3),
    thumbnailsStale: false,
    selected: new Set<number>(),
    busy: false,
    error: null,
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onRotate: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    onRotatePage: vi.fn(),
    onDeletePage: vi.fn(),
    onExtract: vi.fn(),
    onMerge: vi.fn(),
    onSplit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<PagePanel {...props} />);
  return props;
}

/** Drags the page at `from` onto the page at `to`. */
function dragPage(from: number, to: number): void {
  const source = screen.getByTestId(`page-item-${String(from)}`);
  const target = screen.getByTestId(`page-item-${String(to)}`);
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
    getData: vi.fn(() => String(from)),
  };

  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

function button(id: string): HTMLButtonElement {
  return screen.getByTestId<HTMLButtonElement>(id);
}

describe('PagePanel', () => {
  it('lists a row per page', () => {
    renderPanel({ rotations: [0, 0, 0, 0] });

    expect(screen.getByTestId('pages-list').children).toHaveLength(4);
  });

  it("badges only what has been turned since the document was opened", () => {
    // A page can carry /Rotate 90 and still display upright; saying "90°" about
    // it tells the reader their page is sideways when it plainly is not.
    renderPanel({ rotations: [90, 90, 0], turnedBy: [0, 90, 0] });

    expect(screen.queryByTestId("page-0-rotation")).toBeNull();
    expect(screen.getByTestId("page-1-rotation").textContent).toBe("+90°");
  });

  it('reports which page was ticked', () => {
    const { onToggle } = renderPanel();

    fireEvent.click(screen.getByTestId('page-2'));

    expect(onToggle).toHaveBeenCalledWith(2, false);
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

describe('PagePanel thumbnails', () => {
  it('shows a preview of each page', () => {
    // A page is identifiable by what is on it, not by its number.
    renderPanel();

    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByAltText('Page 1').getAttribute('src')).toBe('blob:thumb-0');
  });

  it('keeps the previous previews on screen while new ones render', () => {
    // Emptying the list would collapse it and throw away the scroll position at
    // exactly the moment the user wants to see what their edit did.
    renderPanel({ thumbnailsStale: true });

    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByTestId('pages-list').getAttribute('data-stale')).toBe('true');
  });

  it('still lists a page whose preview has not arrived', () => {
    renderPanel({ rotations: [0, 0, 0, 0], thumbnails: thumbsFor(2) });

    expect(screen.getByTestId('pages-list').children).toHaveLength(4);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});

describe('PagePanel drag to reorder', () => {
  it('reports the page dragged and where it was dropped', () => {
    const { onMove } = renderPanel();

    dragPage(0, 2);

    expect(onMove).toHaveBeenCalledWith([0], 2);
  });

  it('ignores a page dropped onto itself', () => {
    const { onMove } = renderPanel();

    dragPage(1, 1);

    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not offer dragging while an operation runs', () => {
    renderPanel({ busy: true });

    expect(screen.getByTestId('page-item-0').getAttribute('draggable')).toBe('false');
  });
});

describe('PagePanel per-page controls', () => {
  it('rotates the page its buttons sit on', () => {
    const { onRotatePage } = renderPanel();

    fireEvent.click(screen.getByTestId('page-1-rotate-right'));
    fireEvent.click(screen.getByTestId('page-1-rotate-left'));

    expect(onRotatePage).toHaveBeenNthCalledWith(1, 1, 90);
    expect(onRotatePage).toHaveBeenNthCalledWith(2, 1, 270);
  });

  it('acts on that page alone even when others are selected', () => {
    // The page the button sits on is the one being pointed at; borrowing the
    // selection would make the same click do different things.
    const { onRotatePage } = renderPanel({ selected: new Set([0, 2]) });

    fireEvent.click(screen.getByTestId('page-1-rotate-right'));

    expect(onRotatePage).toHaveBeenCalledWith(1, 90);
  });

  it('deletes the page its button sits on', () => {
    const { onDeletePage } = renderPanel();

    fireEvent.click(screen.getByTestId('page-2-delete'));

    expect(onDeletePage).toHaveBeenCalledWith(2);
  });

  it('will not delete the only page there is', () => {
    renderPanel({ rotations: [0], turnedBy: [0], thumbnails: thumbsFor(1) });

    expect(screen.getByTestId<HTMLButtonElement>('page-0-delete').disabled).toBe(true);
  });
});

describe('PagePanel range selection', () => {
  it('reports a shift-click as extending the selection', () => {
    const { onToggle } = renderPanel({ selected: new Set([0]) });

    fireEvent.click(screen.getByTestId('page-2'), { shiftKey: true });

    expect(onToggle).toHaveBeenCalledWith(2, true);
  });

  it('reports a plain click as a plain toggle', () => {
    const { onToggle } = renderPanel({ selected: new Set([0]) });

    fireEvent.click(screen.getByTestId('page-2'));

    expect(onToggle).toHaveBeenCalledWith(2, false);
  });

  it('shows every selected page as ticked', () => {
    // A row highlighted but unticked, or the reverse, means the boxes have
    // stopped agreeing with the state that drives them.
    renderPanel({ selected: new Set([1, 2]) });

    expect(screen.getByTestId<HTMLInputElement>('page-0').checked).toBe(false);
    expect(screen.getByTestId<HTMLInputElement>('page-1').checked).toBe(true);
    expect(screen.getByTestId<HTMLInputElement>('page-2').checked).toBe(true);
  });
});

describe('PagePanel dragging a selection', () => {
  it('moves the whole selection when one of its pages is dragged', () => {
    const { onMove } = renderPanel({ selected: new Set([0, 1]) });

    dragPage(0, 2);

    expect(onMove).toHaveBeenCalledWith([0, 1], 2);
  });

  it('moves only the dragged page when it is outside the selection', () => {
    // Dragging something you have not selected should not drag what you have.
    const { onMove } = renderPanel({ selected: new Set([0, 1]) });

    dragPage(2, 0);

    expect(onMove).toHaveBeenCalledWith([2], 0);
  });

  it('ignores a drop back onto the selection being dragged', () => {
    const { onMove } = renderPanel({ selected: new Set([0, 1]) });

    dragPage(0, 1);

    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('PagePanel split', () => {
  it('splits at the ticked pages', () => {
    const { onSplit } = renderPanel({ selected: new Set([1]) });

    fireEvent.click(button('pages-split'));

    expect(onSplit).toHaveBeenCalledOnce();
  });

  it('cannot split with nothing ticked', () => {
    renderPanel();

    expect(button('pages-split').disabled).toBe(true);
  });

  it('cannot split before the first page alone, which would change nothing', () => {
    renderPanel({ selected: new Set([0]) });

    expect(button('pages-split').disabled).toBe(true);
  });

  it('can split when a later page is ticked as well', () => {
    renderPanel({ selected: new Set([0, 2]) });

    expect(button('pages-split').disabled).toBe(false);
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
