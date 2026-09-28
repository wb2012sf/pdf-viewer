/**
 * Adds "Expand all" and "Collapse all" to the viewer's Outline sidebar.
 *
 * The viewer only gives each bookmark its own arrow, and keeps which ones are
 * open in the Outline component's private state — the bookmark plugin has no
 * API for it. So the buttons work the way a person would: by pressing arrows,
 * one at a time, until every bookmark is in the wanted state.
 *
 * One at a time, and re-reading the list after each press, because the viewer
 * keys that state by a bookmark's index *within its own level*: the first
 * child of Chapter 2 shares its open/closed state with Chapter 1. Pressing two
 * arrows that share a key in one pass would toggle it twice and change
 * nothing. Driving everything to one state is still well-defined, since every
 * bookmark sharing a key wants the same answer.
 *
 * Like the form fixes this works inside the viewer's shadow DOM. The one hook
 * it relies on is the `.outline-tree` class — the only class the component
 * carries — plus the shape under it: a bookmark is a row holding its arrow,
 * followed, only while open, by a div of its children.
 */

/** Marks the bar holding the two buttons. */
const BAR = 'data-outline-controls';

/**
 * Upper bound on arrow presses in one go. Each press opens or closes at least
 * one key, and there are no more keys than bookmarks, so a real outline stays
 * far below this; it only stops a list that never settles from looping.
 */
const MAX_PRESSES = 2000;

/** Whether the bookmark whose arrow this is currently shows its children. */
function isOpen(arrow: Element): boolean {
  return arrow.parentElement?.nextElementSibling != null;
}

/** Lets the viewer re-render after a press. Preact renders on a later tick. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Opens or closes every bookmark in the list, at every depth. */
export async function setOutlineExpanded(tree: Element, expanded: boolean): Promise<void> {
  for (let press = 0; press < MAX_PRESSES; press++) {
    const arrow = Array.from(tree.querySelectorAll('button')).find((candidate) => isOpen(candidate) !== expanded);
    if (!arrow) return;
    arrow.click();
    await nextTick();
  }
}

function makeButton(doc: Document, label: string, testId: string, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.testid = testId;
  // The viewer's own utility classes, so the buttons follow its theme.
  button.className = 'text-fg-secondary hover:bg-interactive-hover rounded px-2 py-1 text-xs';
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Adds the buttons above the bookmark list, if there is a list with anything
 * to open, and removes them if not. Safe to run repeatedly.
 */
export function applyOutlineControls(root: ParentNode): void {
  const tree = root.querySelector('.outline-tree');
  const scroller = tree?.parentElement;
  const panel = scroller?.parentElement;
  const existing = root.querySelector(`[${BAR}]`);

  // A flat outline has no arrows, so there is nothing for either button to do.
  // Top-level bookmarks are always shown, so a nested outline keeps at least
  // one arrow in view however far it is collapsed.
  const nested = tree?.querySelector('button') != null;
  if (!tree || !scroller || !panel || !nested) {
    existing?.remove();
    return;
  }
  if (existing?.nextElementSibling === scroller) return;
  existing?.remove();

  const doc = panel.ownerDocument;
  const bar = doc.createElement('div');
  bar.setAttribute(BAR, '');
  bar.className = 'border-border-subtle flex justify-end gap-2 border-b px-2 py-1';

  let busy = false;
  const run = (expanded: boolean) => () => {
    if (busy) return;
    busy = true;
    // Looked up again rather than captured: the list may have been rebuilt
    // (a new document) since the bar was added.
    const current = root.querySelector('.outline-tree');
    void (current ? setOutlineExpanded(current, expanded) : Promise.resolve()).finally(() => {
      busy = false;
    });
  };

  bar.append(
    makeButton(doc, 'Expand all', 'outline-expand-all', run(true)),
    makeButton(doc, 'Collapse all', 'outline-collapse-all', run(false)),
  );
  panel.insertBefore(bar, scroller);
}

/**
 * Keeps the buttons in place as the sidebar opens, closes and changes document.
 *
 * Returns a function that stops watching.
 */
export function watchOutlineControls(root: ParentNode & Node): () => void {
  applyOutlineControls(root);

  const observer = new MutationObserver(() => {
    applyOutlineControls(root);
  });
  observer.observe(root, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
  };
}
