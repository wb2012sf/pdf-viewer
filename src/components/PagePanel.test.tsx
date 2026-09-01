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
    currentPage: null,
    onShowPage: vi.fn(),
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

/**
 * Drags the page at `from` onto the page at `to`, the way a mouse does it.
 *
 * Reordering uses pointer events rather than HTML5 drag-and-drop, so this drives
 * the same events a real press-move-release produces.
 */
function dragPage(from: number, to: number): void {
  const source = screen.getByTestId(`page-item-${String(from)}`);

  // jsdom gives every element a zero-sized box, so the drop target is stubbed
  // by placing each row in its own horizontal band.
  const items = screen.getByTestId('pages-list').querySelectorAll('li');
  items.forEach((item, index) => {
    item.getBoundingClientRect = () =>
      ({ top: index * 100, bottom: index * 100 + 99, left: 0, right: 200 }) as DOMRect;
  });

  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: from * 100 + 10 });
  fireEvent.pointerMove(source, { clientX: 10, clientY: to * 100 + 10 });
  fireEvent.pointerUp(source, { clientX: 10, clientY: to * 100 + 10 });
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

  it('does not start a drag while an operation runs', () => {
    const { onMove } = renderPanel({ busy: true });

    dragPage(0, 2);

    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not treat a click that barely moves as a drag', () => {
    // Otherwise ticking a page would sometimes reorder the document.
    const { onMove } = renderPanel();
    const source = screen.getByTestId('page-item-0');

    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(source, { clientX: 12, clientY: 11 });
    fireEvent.pointerUp(source, { clientX: 12, clientY: 11 });

    expect(onMove).not.toHaveBeenCalled();
  });

  it('ignores a press that starts on one of the page buttons', () => {
    const { onMove } = renderPanel();

    fireEvent.pointerDown(screen.getByTestId('page-0-rotate-right'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(screen.getByTestId('page-item-0'), { clientX: 10, clientY: 210 });
    fireEvent.pointerUp(screen.getByTestId('page-item-0'), { clientX: 10, clientY: 210 });

    expect(onMove).not.toHaveBeenCalled();
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

describe('PagePanel resizing', () => {
  it('widens as the handle is dragged, and the previews grow with it', () => {
    renderPanel();
    const panel = screen.getByTestId('page-panel');
    const before = panel.style.getPropertyValue('--thumb-height');

    const resizer = screen.getByTestId('pages-resizer');
    fireEvent.pointerDown(resizer, { clientX: 250 });
    fireEvent.pointerMove(resizer, { clientX: 400 });
    fireEvent.pointerUp(resizer, { clientX: 400 });

    // Widening the panel has to make the pages bigger — otherwise it just
    // leaves them marooned in a wider column.
    expect(parseInt(panel.style.flexBasis, 10)).toBeGreaterThan(300);
    expect(parseInt(panel.style.getPropertyValue('--thumb-height'), 10)).toBeGreaterThan(
      parseInt(before, 10),
    );
  });

  it('will not be dragged narrower than it is usable', () => {
    renderPanel();
    const resizer = screen.getByTestId('pages-resizer');

    fireEvent.pointerDown(resizer, { clientX: 250 });
    fireEvent.pointerMove(resizer, { clientX: -500 });
    fireEvent.pointerUp(resizer, { clientX: -500 });

    expect(parseInt(screen.getByTestId('page-panel').style.flexBasis, 10)).toBeGreaterThanOrEqual(170);
  });

  it('will not be dragged wide enough to swallow the viewer', () => {
    renderPanel();
    const resizer = screen.getByTestId('pages-resizer');

    fireEvent.pointerDown(resizer, { clientX: 250 });
    fireEvent.pointerMove(resizer, { clientX: 5000 });
    fireEvent.pointerUp(resizer, { clientX: 5000 });

    expect(parseInt(screen.getByTestId('page-panel').style.flexBasis, 10)).toBeLessThanOrEqual(560);
  });

  it('resizes from the keyboard, so the handle is not mouse-only', () => {
    renderPanel();
    const resizer = screen.getByTestId('pages-resizer');
    const before = parseInt(screen.getByTestId('page-panel').style.flexBasis, 10);

    fireEvent.keyDown(resizer, { key: 'ArrowRight' });

    expect(parseInt(screen.getByTestId('page-panel').style.flexBasis, 10)).toBeGreaterThan(before);
  });

  it('reports its size for assistive technology', () => {
    renderPanel();
    const resizer = screen.getByTestId('pages-resizer');

    expect(resizer.getAttribute('role')).toBe('separator');
    expect(resizer.getAttribute('aria-valuenow')).toBeTruthy();
  });
});

describe('PagePanel and the viewer', () => {
  it('marks the page the viewer is showing', () => {
    // Distinct from selection: what the reader is looking at is not the same
    // question as what an operation would act on.
    renderPanel({ currentPage: 1, selected: new Set([2]) });

    expect(screen.getByTestId('page-item-1').getAttribute('data-current')).toBe('true');
    expect(screen.getByTestId('page-item-2').getAttribute('data-current')).toBe('false');
  });

  it('marks nothing when the viewer has not said', () => {
    renderPanel({ currentPage: null });

    expect(screen.getByTestId('page-item-0').getAttribute('data-current')).toBe('false');
  });

  it('asks the viewer to show a page when its preview is clicked', () => {
    const { onShowPage } = renderPanel();

    fireEvent.click(screen.getByTestId('page-2-show'));

    expect(onShowPage).toHaveBeenCalledWith(2);
  });

  it('does not tick a page just because it was shown', () => {
    // Navigating and selecting are different intentions.
    const { onShowPage, onToggle } = renderPanel();

    fireEvent.click(screen.getByTestId('page-1-show'));

    expect(onShowPage).toHaveBeenCalledWith(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
