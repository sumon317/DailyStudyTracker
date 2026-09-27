const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'summary',
    '[contenteditable]:not([contenteditable="false"])',
    // Only 0 and a positive value put an element in the tab order; every
    // negative value is programmatic-only, not just -1.
    '[tabindex]:not([tabindex^="-"])',
].join(', ');

/**
 * Whether `element` sits in the rendered part of a collapsed `<details>`.
 *
 * The UA stylesheet makes `details:not([open]) > *:not(summary)` `display: none`,
 * so such a control cannot take focus and cannot be reached, however it is
 * marked. Only the first `<summary>` of a closed `<details>` stays rendered, and
 * an inner `<details open>` inside a collapsed one is still inside it - so the
 * whole ancestor chain is walked rather than just the nearest one.
 */
const isCollapsedDetailsContent = (element: HTMLElement): boolean => {
    for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
        if (node.tagName !== 'DETAILS') {
            continue;
        }
        const details = node as HTMLDetailsElement;
        if (details.open) {
            continue;
        }
        const summary = Array.from(details.children).find((child) => child.tagName === 'SUMMARY');
        if (!summary?.contains(element)) {
            return true;
        }
    }
    return false;
};

/**
 * Whether a control can really take focus from a keyboard.
 *
 * `aria-hidden` and `hidden` are inherited in effect, so a control nested
 * inside such a subtree is as unreachable as one that carries the attribute
 * itself. Checking `closest` rather than the element's own attributes is what
 * makes the difference; without it a closing widget can hand focus to an
 * invisible control.
 */
const isVisibleTarget = (element: HTMLElement): boolean => {
    if (element.hidden || element.closest('[hidden]') !== null) {
        return false;
    }
    if (element.getAttribute('tabindex')?.startsWith('-') === true) {
        return false;
    }
    // A control inside a disabled <fieldset> keeps its own `disabled` attribute
    // unset, so the `:not([disabled])` selectors above still match it even
    // though the browser will not let it take focus. The IDL property reflects
    // the content attribute only, which is why the pseudo-class is the check.
    if (element.matches(':disabled')) {
        return false;
    }
    if (isCollapsedDetailsContent(element)) {
        return false;
    }
    return element.closest('[aria-hidden="true"]') === null;
};

export const getFocusableElements = (root: ParentNode): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisibleTarget);

/**
 * Moves focus to whatever follows `container` in document order, or back to
 * `fallback` when nothing does.
 *
 * Menus and popovers that disappear while they still hold focus would otherwise
 * drop the caret on `<body>` and break the rest of the tab sequence, so a
 * closing widget has to hand focus over explicitly.
 */
export const focusAfterContainer = (container: HTMLElement | null, fallback?: HTMLElement | null): void => {
    if (!container) {
        fallback?.focus();
        return;
    }

    const focusable = getFocusableElements(document);
    const inside = focusable.filter((element) => container.contains(element));
    const lastInside = inside[inside.length - 1];
    // With nothing focusable inside, the container's own position is the anchor:
    // a panel whose only control is hidden still has whatever comes after it.
    const next =
        lastInside !== undefined
            ? focusable[focusable.indexOf(lastInside) + 1]
            : focusable.find(
                  (element) => (element.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
              );

    (next ?? fallback ?? container).focus();
};
