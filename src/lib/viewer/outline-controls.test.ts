// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyOutlineControls, setOutlineExpanded } from './outline-controls';

/**
 * A stand-in for the viewer's Outline panel, reproducing the parts this
 * module depends on:
 *
 *  - the markup: `.outline-tree` inside a scrolling div inside the panel, each
 *    bookmark a div holding a row (arrow button, title) and, only while open,
 *    a div of children;
 *  - the open/closed state, keyed — as the viewer keys it — by a bookmark's
 *    index *within its own level*, so bookmarks at the same index share it;
 *  - re-rendering after a click on a later tick, as Preact does.
 */
interface Bookmark {
  title: string;
  children?: Bookmark[];
}

function fakeOutline(bookmarks: Bookmark[], initiallyOpen: string[]): { root: HTMLElement; tree: HTMLElement } {
  const root = document.createElement('div');
  const panel = document.createElement('div');
  const scroll = document.createElement('div');
  const tree = document.createElement('div');
  tree.className = 'outline-tree';
  scroll.append(tree);
  panel.append(scroll);
  root.append(panel);
  document.body.append(root);

  const open = new Set(initiallyOpen);
  const render = (): void => {
    const node = (bookmark: Bookmark, index: number): HTMLElement => {
      const key = `bookmark-${String(index)}`;
      const wrapper = document.createElement('div');
      const row = document.createElement('div');
      if (bookmark.children?.length) {
        const arrow = document.createElement('button');
        arrow.addEventListener('click', () => {
          if (open.has(key)) open.delete(key);
          else open.add(key);
          setTimeout(render, 0);
        });
        row.append(arrow);
      }
      const title = document.createElement('span');
      title.textContent = bookmark.title;
      row.append(title);
      wrapper.append(row);
      if (bookmark.children?.length && open.has(key)) {
        const children = document.createElement('div');
        bookmark.children.forEach((child, childIndex) => children.append(node(child, childIndex)));
        wrapper.append(children);
      }
      return wrapper;
    };
    tree.replaceChildren(...bookmarks.map((bookmark, index) => node(bookmark, index)));
  };
  render();
  return { root, tree };
}

const titles = (tree: Element): string[] => Array.from(tree.querySelectorAll('span')).map((span) => span.textContent ?? '');

// Chapter 2 and Detail 1.1 collide: both sit at index 1 of their level.
const BOOK: Bookmark[] = [
  { title: 'Chapter 1', children: [{ title: 'Section 1.1' }, { title: 'Detail 1.1', children: [{ title: 'Note' }] }] },
  { title: 'Chapter 2', children: [{ title: 'Section 2.1', children: [{ title: 'Detail 2.1.1' }] }] },
];

afterEach(() => {
  document.body.replaceChildren();
});

describe('setOutlineExpanded', () => {
  it('opens every level, including ones hidden until their parent opens', async () => {
    const { tree } = fakeOutline(BOOK, []);

    await setOutlineExpanded(tree, true);

    expect(titles(tree)).toEqual([
      'Chapter 1', 'Section 1.1', 'Detail 1.1', 'Note', 'Chapter 2', 'Section 2.1', 'Detail 2.1.1',
    ]);
  });

  it('closes every level', async () => {
    const { tree } = fakeOutline(BOOK, ['bookmark-0', 'bookmark-1']);

    await setOutlineExpanded(tree, false);

    expect(titles(tree)).toEqual(['Chapter 1', 'Chapter 2']);
  });

  it('does nothing to an outline already in the wanted state', async () => {
    const { tree } = fakeOutline([{ title: 'Only' }], []);

    await setOutlineExpanded(tree, true);

    expect(titles(tree)).toEqual(['Only']);
  });
});

describe('applyOutlineControls', () => {
  it('puts the buttons above the list when some bookmark has children', () => {
    const { root, tree } = fakeOutline(BOOK, []);

    applyOutlineControls(root);

    const bar = root.querySelector('[data-outline-controls]');
    expect(bar?.nextElementSibling).toBe(tree.parentElement);
    expect(bar?.querySelector('[data-testid="outline-expand-all"]')).not.toBeNull();
    expect(bar?.querySelector('[data-testid="outline-collapse-all"]')).not.toBeNull();
  });

  it('adds them only once, however often it runs', () => {
    const { root } = fakeOutline(BOOK, []);

    applyOutlineControls(root);
    applyOutlineControls(root);

    expect(root.querySelectorAll('[data-outline-controls]')).toHaveLength(1);
  });

  it('offers nothing for a flat outline, where there is nothing to open', () => {
    const { root } = fakeOutline([{ title: 'One' }, { title: 'Two' }], []);

    applyOutlineControls(root);

    expect(root.querySelector('[data-outline-controls]')).toBeNull();
  });

  it('drives the list from its buttons', async () => {
    const { root, tree } = fakeOutline(BOOK, []);
    applyOutlineControls(root);

    root.querySelector<HTMLButtonElement>('[data-testid="outline-expand-all"]')?.click();

    await expect.poll(() => titles(tree)).toContain('Detail 2.1.1');
  });
});
