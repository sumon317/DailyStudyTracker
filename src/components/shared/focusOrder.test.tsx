import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { focusAfterContainer, getFocusableElements } from './focusOrder';

const labelsOf = (root: ParentNode): (string | null)[] =>
    getFocusableElements(root).map((element) => element.getAttribute('aria-label') || element.textContent);

describe('focusOrder', () => {
    it('lists focusable controls in document order and skips disabled ones', () => {
        render(
            <div>
                <a href="/one">One</a>
                <button type="button" disabled>
                    Disabled
                </button>
                <button type="button">Two</button>
                <input type="text" aria-label="Three" />
                <div tabIndex={-1}>Programmatic only</div>
                <select aria-label="Four">
                    <option>Option</option>
                </select>
            </div>,
        );

        expect(labelsOf(document)).toEqual(['One', 'Two', 'Three', 'Four']);
    });

    it('includes natively focusable markup that a bare control selector would miss', () => {
        render(
            <div>
                <input type="hidden" aria-label="Hidden input" />
                <details>
                    <summary>Details summary</summary>
                </details>
                <div contentEditable suppressContentEditableWarning>
                    Editable
                </div>
                <div contentEditable={false}>Not editable</div>
            </div>,
        );

        expect(labelsOf(document)).toEqual(['Details summary', 'Editable']);
    });

    it('excludes controls anywhere inside a hidden subtree, not just on the element itself', () => {
        render(
            <div>
                <button type="button">Visible one</button>
                <div aria-hidden="true">
                    <div>
                        <button type="button">Aria hidden</button>
                    </div>
                </div>
                <div hidden>
                    <button type="button">Hidden attribute</button>
                </div>
                <button type="button">Visible two</button>
            </div>,
        );

        expect(labelsOf(document)).toEqual(['Visible one', 'Visible two']);
    });

    it('excludes controls a disabled fieldset takes out of the tab order', () => {
        render(
            <div>
                <fieldset disabled>
                    {/* No `disabled` attribute of its own, so the `:not([disabled])`
                        selectors match it even though the browser will not focus it. */}
                    <button type="button">In disabled fieldset</button>
                    <input type="text" aria-label="Also in fieldset" />
                </fieldset>
                <button type="button">Outside</button>
            </div>,
        );

        expect(labelsOf(document)).toEqual(['Outside']);
    });

    it('excludes a control carried inside the first legend of a disabled fieldset', () => {
        // The legend is exempt from the fieldset's disabled state.
        render(
            <fieldset disabled>
                <legend>
                    <button type="button">In legend</button>
                </legend>
                <button type="button">In fieldset</button>
            </fieldset>,
        );

        expect(labelsOf(document)).toEqual(['In legend']);
    });

    it('excludes controls inside a collapsed details, which the browser renders as display:none', () => {
        // `details:not([open]) > *:not(summary)` is `display: none` in the UA
        // stylesheet, so a control in there is unreachable however it is marked.
        // Focusing one is a no-op that strands the caret on <body> - exactly the
        // outcome `focusAfterContainer` exists to prevent.
        render(
            <div>
                <details>
                    <summary>Collapsed summary</summary>
                    <button type="button">Hidden until opened</button>
                    <input type="text" aria-label="Also hidden" />
                </details>
                <details open>
                    <summary>Open summary</summary>
                    <button type="button">Reachable</button>
                </details>
            </div>,
        );

        expect(labelsOf(document)).toEqual(['Collapsed summary', 'Open summary', 'Reachable']);
    });

    it('excludes controls hidden in a details nested inside another collapsed one', () => {
        render(
            <details>
                <summary>Outer</summary>
                <details open>
                    <summary>Inner summary</summary>
                    <button type="button">Still hidden</button>
                </details>
            </details>,
        );

        // The inner details is open, but its whole subtree is inside a collapsed
        // ancestor, so nothing in it is rendered.
        expect(labelsOf(document)).toEqual(['Outer']);
    });

    it('excludes every negative tabindex, not just -1', () => {
        render(
            <div>
                <div tabIndex={-1}>Minus one</div>
                <div tabIndex={-2}>Minus two</div>
                <button type="button" tabIndex={-3}>
                    Minus three
                </button>
                {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a generic container with tabIndex is exactly the markup this selector has to classify */}
                <div tabIndex={0}>Zero</div>
                {/* biome-ignore lint/a11y/noPositiveTabindex: the rule under test is that a positive value is a real tab stop, so the fixture needs one */}
                <button type="button" tabIndex={2}>
                    Positive
                </button>
            </div>,
        );

        expect(labelsOf(document)).toEqual(['Zero', 'Positive']);
    });

    it('keeps a natively disabled control out even without a matching attribute selector', () => {
        render(
            <div>
                <select disabled aria-label="Disabled select">
                    <option>Option</option>
                </select>
                <textarea disabled aria-label="Disabled textarea" />
                <select aria-label="Enabled select">
                    <option>Option</option>
                </select>
            </div>,
        );

        expect(labelsOf(document)).toEqual(['Enabled select']);
    });

    it('does not treat a negative tabindex as a candidate when handing focus on', () => {
        render(
            <div>
                <div data-testid="panel">
                    <button type="button">Inside</button>
                </div>
                <button type="button" tabIndex={-1}>
                    Skipped
                </button>
                <button type="button">Visible</button>
            </div>,
        );

        focusAfterContainer(screen.getByTestId('panel'));

        expect(screen.getByRole('button', { name: 'Visible' })).toHaveFocus();
    });

    it('reads only the subtree it is given, not the whole document', () => {
        render(
            <div>
                <button type="button">Outside</button>
                <div data-testid="panel">
                    <button type="button">Inside</button>
                </div>
            </div>,
        );

        const inside = getFocusableElements(screen.getByTestId('panel'));

        expect(inside).toHaveLength(1);
        expect(inside[0]).toHaveTextContent('Inside');
    });

    it('moves focus to the first control after the given container', () => {
        render(
            <div>
                <button type="button">Before</button>
                <div data-testid="panel">
                    <button type="button">Inside one</button>
                    <button type="button">Inside two</button>
                </div>
                <button type="button">After</button>
            </div>,
        );

        focusAfterContainer(screen.getByTestId('panel'));

        expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    });

    it('skips over controls in a hidden subtree that follows the container', () => {
        render(
            <div>
                <div data-testid="panel">
                    <button type="button">Inside</button>
                </div>
                <div aria-hidden="true">
                    <button type="button">Collapsed drawer</button>
                </div>
                <div hidden>
                    <button type="button">Hidden panel</button>
                </div>
                <button type="button">Visible</button>
            </div>,
        );

        focusAfterContainer(screen.getByTestId('panel'));

        expect(screen.getByRole('button', { name: 'Visible' })).toHaveFocus();
    });

    it('falls back to the trigger when nothing follows the container', () => {
        render(
            <div>
                <div data-testid="panel">
                    <button type="button">Inside</button>
                </div>
                <button type="button">Fallback</button>
            </div>,
        );

        focusAfterContainer(screen.getByTestId('panel'), screen.getByRole('button', { name: 'Fallback' }));

        expect(screen.getByRole('button', { name: 'Fallback' })).toHaveFocus();
    });

    it('falls back to the trigger when the only following control is hidden', () => {
        render(
            <div>
                <div data-testid="panel">
                    <button type="button">Inside</button>
                </div>
                <div aria-hidden="true">
                    <button type="button">Hidden</button>
                </div>
                <button type="button">Fallback</button>
            </div>,
        );

        focusAfterContainer(screen.getByTestId('panel'), screen.getByRole('button', { name: 'Fallback' }));

        expect(screen.getByRole('button', { name: 'Fallback' })).toHaveFocus();
    });

    it('falls back to the trigger when there is no container at all', () => {
        render(<button type="button">Fallback</button>);

        focusAfterContainer(null, screen.getByRole('button', { name: 'Fallback' }));

        expect(screen.getByRole('button', { name: 'Fallback' })).toHaveFocus();
    });

    it('does nothing when there is neither a container nor a fallback', () => {
        render(<button type="button">Untouched</button>);

        focusAfterContainer(null);

        expect(screen.getByRole('button', { name: 'Untouched' })).not.toHaveFocus();
    });

    it('focuses the container itself when neither a next control nor a fallback exists', () => {
        render(
            <div data-testid="panel" tabIndex={-1}>
                <button type="button">Inside</button>
            </div>,
        );

        focusAfterContainer(screen.getByTestId('panel'));

        expect(screen.getByTestId('panel')).toHaveFocus();
    });

    it('resolves the next control relative to a container that holds no focusable markup', () => {
        render(
            <div>
                <div data-testid="panel">Nothing to focus in here</div>
                <button type="button">After</button>
            </div>,
        );

        focusAfterContainer(screen.getByTestId('panel'));

        expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    });
});
