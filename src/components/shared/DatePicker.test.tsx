import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DatePicker from './DatePicker';

const openCalendar = async (user: ReturnType<typeof userEvent.setup>) => {
    const trigger = screen.getByRole('button', { name: /Study Date/i });
    await user.click(trigger);
    return screen.findByRole('dialog');
};

/**
 * Opens the calendar without userEvent.
 *
 * userEvent drives its own waits through the clock, so pairing it with fake
 * timers makes a test depend on timer plumbing instead of on the component.
 * `fireEvent` plus `act` keeps the fake-timer cases fully deterministic.
 */
const openCalendarSync = (): HTMLElement => {
    const trigger = screen.getByRole('button', { name: /Study Date/i });
    act(() => {
        fireEvent.click(trigger);
    });
    return screen.getByRole('dialog');
};

const focusedDate = () => document.activeElement?.getAttribute('data-date');

/** The day that owns the grid's single tab stop, whether or not it has DOM focus. */
const rovingTarget = (dialog: HTMLElement) => dialog.querySelector<HTMLElement>('button[data-date][tabindex="0"]');

const rovingTargetKey = (dialog: HTMLElement) => rovingTarget(dialog)?.getAttribute('data-date');

describe('DatePicker', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('labels the trigger with the study date caption and the current value', () => {
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);

        const trigger = screen.getByRole('button', { name: /Study Date/i });
        expect(trigger).toHaveAccessibleName('Study Date Monday, January 15, 2024');
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps a compact trigger short while preserving the accessible value', () => {
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} compact />);

        const trigger = screen.getByRole('button', { name: /Study Date/i });
        expect(trigger).toHaveTextContent('Jan 15');
        expect(trigger).toHaveTextContent('Study Date');
    });

    it('falls back to today when the incoming date is not a real calendar day', () => {
        render(<DatePicker date="2024-02-30" setDate={vi.fn()} />);

        const today = new Date();
        const expected = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
        expect(screen.getByRole('button', { name: /Study Date/i })).toHaveTextContent(
            expected.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
            }),
        );
    });

    it('describes the calendar, its month and its keyboard instructions', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);

        const dialog = await openCalendar(user);
        expect(dialog).toHaveAttribute('aria-modal', 'false');
        expect(dialog).toHaveAccessibleName(/Choose study date/);
        expect(within(dialog).getByText(/January 2024/)).toBeInTheDocument();
        const instructions = within(dialog).getByText(/Use the arrow keys to move between dates/i);
        expect(instructions).toHaveTextContent(/Home and End/);
        expect(instructions).toHaveTextContent(/Page Up and Page Down change month/);
        // A header row plus the five weeks January 2024 actually needs: the grid
        // must not advertise a sixth, permanently blank week.
        expect(within(dialog).getByRole('grid', { name: 'Study date calendar' })).toHaveAttribute('aria-rowcount', '6');
        expect(within(dialog).getAllByRole('row')).toHaveLength(6);
    });

    it('lays the grid out Sunday first with no trailing blank week', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-02-01" setDate={vi.fn()} />);

        const dialog = await openCalendar(user);
        expect(within(dialog).getByText(/February 2024/)).toBeInTheDocument();
        // February 2024 starts on a Thursday and needs exactly five weeks.
        expect(within(dialog).getAllByRole('row')).toHaveLength(6);
        expect(within(dialog).getByRole('grid')).toHaveAttribute('aria-rowcount', '6');
        expect(within(dialog).getAllByRole('columnheader')).toHaveLength(7);
        // 35 cells for 29 days: four leading blanks plus two in the final week.
        expect(dialog.querySelectorAll('td[aria-hidden="true"]')).toHaveLength(6);
        const firstRow = within(dialog).getAllByRole('row')[1] as HTMLElement;
        expect(firstRow.children[0]).toHaveAttribute('aria-hidden', 'true');
        expect(firstRow.children[3]).toHaveAttribute('aria-hidden', 'true');
        expect(firstRow.children[4]?.querySelector('button')).toHaveAttribute('data-date', '2024-02-01');
    });

    it('renders a six week month without inventing a seventh', async () => {
        const user = userEvent.setup();
        // June 2024 starts on a Saturday and has 30 days, so it fills six weeks.
        render(<DatePicker date="2024-06-15" setDate={vi.fn()} />);

        const dialog = await openCalendar(user);
        expect(within(dialog).getAllByRole('row')).toHaveLength(7);
        expect(within(dialog).getByRole('grid')).toHaveAttribute('aria-rowcount', '7');
        // 42 cells for 30 days: six leading and six trailing blanks, and no
        // seventh week hanging off the end.
        expect(dialog.querySelectorAll('td[aria-hidden="true"]')).toHaveLength(12);
        expect(within(dialog).getByRole('button', { name: /June 30, 2024/ })).toBeInTheDocument();
    });

    it('marks the selected day on its gridcell instead of as a toggle button', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);

        const dialog = await openCalendar(user);
        const selectedButton = within(dialog).getByRole('button', { name: /January 15, 2024.*selected/i });
        const cell = selectedButton.closest('td');
        expect(cell).toHaveAttribute('role', 'gridcell');
        expect(cell).toHaveAttribute('aria-selected', 'true');
        // aria-pressed would announce 31 toggle buttons instead of one selection.
        expect(selectedButton).not.toHaveAttribute('aria-pressed');
        const unselectedCell = within(dialog)
            .getByRole('button', { name: /January 16, 2024/ })
            .closest('td');
        expect(unselectedCell).toHaveAttribute('aria-selected', 'false');
    });

    it('moves focus with arrows, Home/End and Page keys, tracking the visible month', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);
        const dialog = await openCalendar(user);

        await waitFor(() => expect(focusedDate()).toBe('2024-01-15'));

        await user.keyboard('{ArrowDown}');
        expect(focusedDate()).toBe('2024-01-22');
        await user.keyboard('{ArrowUp}');
        expect(focusedDate()).toBe('2024-01-15');
        await user.keyboard('{ArrowLeft}');
        expect(focusedDate()).toBe('2024-01-14');
        await user.keyboard('{Home}');
        expect(focusedDate()).toBe('2024-01-14');
        await user.keyboard('{End}');
        expect(focusedDate()).toBe('2024-01-20');
        // Page keys keep the day of the month, as the header buttons do.
        await user.keyboard('{PageDown}');
        expect(focusedDate()).toBe('2024-02-20');
        expect(within(dialog).getByText(/February 2024/)).toBeInTheDocument();
        await user.keyboard('{Shift>}{PageDown}{/Shift}');
        expect(focusedDate()).toBe('2025-02-20');
        expect(within(dialog).getByText(/February 2025/)).toBeInTheDocument();
        await user.keyboard('{Shift>}{PageUp}{/Shift}');
        expect(focusedDate()).toBe('2024-02-20');
        await user.keyboard('{PageUp}');
        expect(focusedDate()).toBe('2024-01-20');
    });

    it('clamps keyboard paging to the last day of a shorter month', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-01-31" setDate={vi.fn()} />);
        await openCalendar(user);

        await waitFor(() => expect(focusedDate()).toBe('2024-01-31'));
        await user.keyboard('{PageDown}');

        expect(focusedDate()).toBe('2024-02-29');
        await user.keyboard('{PageUp}');
        expect(focusedDate()).toBe('2024-01-29');
    });

    it('crosses a month boundary with the arrow keys and follows with the grid', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-01-31" setDate={vi.fn()} />);
        const dialog = await openCalendar(user);

        await waitFor(() => expect(focusedDate()).toBe('2024-01-31'));
        await user.keyboard('{ArrowRight}');

        expect(focusedDate()).toBe('2024-02-01');
        expect(within(dialog).getByText(/February 2024/)).toBeInTheDocument();
        await user.keyboard('{ArrowLeft}');
        expect(focusedDate()).toBe('2024-01-31');
        expect(within(dialog).getByText(/January 2024/)).toBeInTheDocument();
    });

    it('switches months with the header buttons and keeps a valid focus target', async () => {
        const user = userEvent.setup();
        const setDate = vi.fn().mockResolvedValue(undefined);
        render(<DatePicker date="2024-01-31" setDate={setDate} />);
        const dialog = await openCalendar(user);
        await waitFor(() => expect(focusedDate()).toBe('2024-01-31'));

        const next = within(dialog).getByRole('button', { name: 'Show next month' });
        await user.click(next);
        // January 31 has no counterpart in February, so the day is clamped.
        expect(within(dialog).getByText(/February 2024/)).toBeInTheDocument();
        expect(rovingTargetKey(dialog)).toBe('2024-02-29');
        // Paging with the pointer must not drag focus out from under the button
        // that was just pressed, or Enter would page a second time.
        expect(next).toHaveFocus();

        const previous = within(dialog).getByRole('button', { name: 'Show previous month' });
        await user.click(previous);
        await user.click(previous);
        expect(within(dialog).getByText(/December 2023/)).toBeInTheDocument();
        expect(rovingTargetKey(dialog)).toBe('2023-12-29');
        expect(previous).toHaveFocus();

        // The paged month is still selectable, and picking closes and commits.
        await user.click(within(dialog).getByRole('button', { name: /December 30, 2023/ }));
        expect(setDate).toHaveBeenCalledWith('2023-12-30');
    });

    it('paginates a whole year with shift and the page keys', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-02-29" setDate={vi.fn()} />);
        const dialog = await openCalendar(user);

        await waitFor(() => expect(focusedDate()).toBe('2024-02-29'));
        await user.keyboard('{Shift>}{PageDown}{/Shift}');
        // 2025 has no 29th of February, so it clamps like a short month does.
        expect(focusedDate()).toBe('2025-02-28');
        expect(within(dialog).getByText(/February 2025/)).toBeInTheDocument();
    });

    it('disables the header paging buttons at the ends of the calendar', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<DatePicker date="9999-12-15" setDate={vi.fn()} />);
        const lastMonth = await openCalendar(user);

        // Year 10000 is not a date key, so there is no next month to show.
        expect(within(lastMonth).getByRole('button', { name: /December 15, 9999/ })).toBeInTheDocument();
        expect(within(lastMonth).getByRole('button', { name: 'Show next month' })).toBeDisabled();
        expect(within(lastMonth).getByRole('button', { name: 'Show previous month' })).toBeEnabled();
        await user.keyboard('{Escape}');

        rerender(<DatePicker date="0001-01-15" setDate={vi.fn()} />);
        const firstMonth = await openCalendar(user);
        expect(within(firstMonth).getByRole('button', { name: /^Monday, January 15, 1\b/ })).toBeInTheDocument();
        // Likewise there is no year 0 to page back into.
        expect(within(firstMonth).getByRole('button', { name: 'Show previous month' })).toBeDisabled();
        expect(within(firstMonth).getByRole('button', { name: 'Show next month' })).toBeEnabled();
    });

    it('keeps paging enabled on both sides in an ordinary month', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);
        const dialog = await openCalendar(user);

        expect(within(dialog).getByRole('button', { name: 'Show previous month' })).toBeEnabled();
        expect(within(dialog).getByRole('button', { name: 'Show next month' })).toBeEnabled();
    });

    it('returns focus to the trigger when Escape closes the calendar', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);
        const trigger = screen.getByRole('button', { name: /Study Date/i });
        await openCalendar(user);
        await waitFor(() => expect(focusedDate()).toBe('2024-01-15'));

        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        // The focused subtree is gone, so focus has to be handed back or it
        // drops onto <body> and the rest of the tab order starts from the top.
        expect(trigger).toHaveFocus();
    });

    it('ignores an unhandled key rather than swallowing it', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);
        await openCalendar(user);
        await waitFor(() => expect(focusedDate()).toBe('2024-01-15'));

        // Tab is consumed by the document listener, not by the day grid, so the
        // grid must not also claim it and stop the browser moving on.
        await user.keyboard('{a}');

        expect(focusedDate()).toBe('2024-01-15');
    });

    it('selects a day, closes, and reports the chosen date', async () => {
        const user = userEvent.setup();
        const setDate = vi.fn().mockResolvedValue(undefined);
        render(<DatePicker date="2024-01-15" setDate={setDate} />);

        const dialog = await openCalendar(user);
        await user.click(within(dialog).getByRole('button', { name: /January 18, 2024/ }));

        expect(setDate).toHaveBeenCalledWith('2024-01-18');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('reports a rejected date change as a persistence error instead of throwing', async () => {
        const user = userEvent.setup();
        const failure = new Error('read only volume');
        const setDate = vi.fn().mockRejectedValue(failure);
        const onError = vi.fn();
        window.addEventListener('study-data-error', onError);

        render(<DatePicker date="2024-01-15" setDate={setDate} />);
        const dialog = await openCalendar(user);
        await user.click(within(dialog).getByRole('button', { name: /January 18, 2024/ }));

        await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
        const reported = onError.mock.calls[0]?.[0] as CustomEvent | undefined;
        expect(reported?.detail).toBe(failure);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        window.removeEventListener('study-data-error', onError);
    });

    it('reports a synchronous failure from the date setter', async () => {
        const user = userEvent.setup();
        const failure = new Error('validation failed');
        const setDate = vi.fn().mockImplementation(() => {
            throw failure;
        });
        const onError = vi.fn();
        window.addEventListener('study-data-error', onError);

        render(<DatePicker date="2024-01-15" setDate={setDate} />);
        const dialog = await openCalendar(user);
        await user.click(within(dialog).getByRole('button', { name: /January 18, 2024/ }));

        await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
        expect((onError.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail).toBe(failure);
        window.removeEventListener('study-data-error', onError);
    });

    it('toggles closed when the trigger is pressed again', async () => {
        const user = userEvent.setup();
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);

        const trigger = screen.getByRole('button', { name: /Study Date/i });
        await user.click(trigger);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        await user.click(trigger);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes on an outside pointer press without stealing focus back', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <button type="button">Outside</button>
                <DatePicker date="2024-01-15" setDate={vi.fn()} />
            </div>,
        );

        const trigger = screen.getByRole('button', { name: /Study Date/i });
        await user.click(trigger);
        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Outside' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).not.toHaveFocus();
    });

    it('closes on touch outside', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <button type="button">Outside</button>
                <DatePicker date="2024-01-15" setDate={vi.fn()} />
            </div>,
        );

        await user.click(screen.getByRole('button', { name: /Study Date/i }));
        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

        fireEvent.touchStart(screen.getByRole('button', { name: 'Outside' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('closes when Tab moves focus out of the calendar', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <DatePicker date="2024-01-15" setDate={vi.fn()} />
                <button type="button">After</button>
            </div>,
        );

        await user.click(screen.getByRole('button', { name: /Study Date/i }));
        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        await waitFor(() => expect(focusedDate()).toBe('2024-01-15'));

        // Roving tabindex means the day grid holds a single tab stop, so one
        // Tab is enough to leave the picker.
        await user.tab();

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    });

    it('reopens on the month and day of the current selection', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: /Study Date/i }));
        await user.click(screen.getByRole('button', { name: 'Show next month' }));
        await waitFor(() => expect(screen.getByText(/February 2024/)).toBeInTheDocument());
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        rerender(<DatePicker date="2024-03-04" setDate={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: /Study Date/i }));

        expect(await screen.findByText(/March 2024/)).toBeInTheDocument();
        await waitFor(() => expect(focusedDate()).toBe('2024-03-04'));
    });

    it('highlights today again after the app is left open past local midnight', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 0, 15, 23, 59, 30, 0));
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);

        const dialog = openCalendarSync();
        expect(within(dialog).getByRole('button', { name: /January 15, 2024, today/i })).toBeInTheDocument();

        // 30s to the rollover, plus the extra second the resync waits so a
        // timer that fires a hair early cannot read the day that just ended.
        act(() => {
            vi.advanceTimersByTime(30_000);
        });
        expect(within(dialog).getByRole('button', { name: /January 15, 2024, today/i })).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(1_000);
        });
        expect(within(dialog).getByRole('button', { name: /January 16, 2024, today/i })).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: /January 15, 2024, today/i })).not.toBeInTheDocument();
    });

    it('keeps tracking today across several nights, not just the first one', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 0, 15, 23, 59, 30, 0));
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);

        const dialog = openCalendarSync();
        for (const expectedDay of [16, 17, 18]) {
            act(() => {
                vi.advanceTimersByTime(24 * 60 * 60 * 1000);
            });
            expect(
                within(dialog).getByRole('button', {
                    name: new RegExp(`January ${expectedDay}, 2024, today`, 'i'),
                }),
            ).toBeInTheDocument();
        }
    });

    it('resyncs today when the window regains focus without a visibility change', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0, 0));
        render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);

        const dialog = openCalendarSync();
        // A clock change on another window, or a long sleep, moves the day
        // without any tab switch for this one to report.
        act(() => {
            vi.setSystemTime(new Date(2024, 0, 17, 8, 0, 0, 0));
            window.dispatchEvent(new Event('focus'));
        });

        expect(within(dialog).getByRole('button', { name: /January 17, 2024, today/i })).toBeInTheDocument();
    });

    it('stops re-arming the midnight timer once unmounted', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 0, 15, 23, 59, 30, 0));
        const { unmount } = render(<DatePicker date="2024-01-15" setDate={vi.fn()} />);
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        // A self-rescheduling timer left behind would keep the app awake for the
        // life of the process.
        expect(vi.getTimerCount()).toBe(0);
    });
});
