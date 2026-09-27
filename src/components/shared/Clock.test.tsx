import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Clock from './Clock';

const formatExpected = (date: Date) =>
    date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    });

const renderedTime = () => screen.getByRole('timer', { name: 'Current time' }).textContent ?? '';

describe('Clock', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 0, 15, 9, 30, 15, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('exposes a non-announcing timer with an accessible name', () => {
        render(<Clock />);

        const timer = screen.getByRole('timer', { name: 'Current time' });
        // A ticking clock must not be a live region; it would be announced
        // every second.
        expect(timer).toHaveAttribute('aria-live', 'off');
        expect(timer).toHaveTextContent(formatExpected(new Date(2024, 0, 15, 9, 30, 15)));
    });

    it('repaints exactly on the one-second interval boundary', () => {
        render(<Clock />);
        const timer = screen.getByRole('timer', { name: 'Current time' });

        act(() => {
            vi.advanceTimersByTime(999);
        });
        expect(timer).toHaveTextContent(formatExpected(new Date(2024, 0, 15, 9, 30, 15)));

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(timer).toHaveTextContent(formatExpected(new Date(2024, 0, 15, 9, 30, 16)));

        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(timer).toHaveTextContent(formatExpected(new Date(2024, 0, 15, 9, 30, 18)));
    });

    it('aligns the first tick to the next second boundary instead of drifting from mount', () => {
        // Mounting mid-second is the common case: a plain 1s interval would
        // render the previous second for the remainder of that second.
        vi.setSystemTime(new Date(2024, 0, 15, 9, 30, 15, 400));
        render(<Clock />);

        act(() => {
            vi.advanceTimersByTime(599);
        });
        expect(renderedTime()).toBe(formatExpected(new Date(2024, 0, 15, 9, 30, 15)));

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(renderedTime()).toBe(formatExpected(new Date(2024, 0, 15, 9, 30, 16)));
    });

    it('keeps ticking across a minute and hour rollover', () => {
        render(<Clock />);
        const timer = screen.getByRole('timer', { name: 'Current time' });

        act(() => {
            vi.advanceTimersByTime(45_000);
        });
        expect(timer).toHaveTextContent(formatExpected(new Date(2024, 0, 15, 9, 31, 0)));

        act(() => {
            vi.advanceTimersByTime(29 * 60_000);
        });
        expect(timer).toHaveTextContent(formatExpected(new Date(2024, 0, 15, 10, 0, 0)));
    });

    it('keeps ticking across a local midnight and month boundary', () => {
        vi.setSystemTime(new Date(2024, 1, 29, 23, 59, 58, 0));
        render(<Clock />);

        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(renderedTime()).toBe(formatExpected(new Date(2024, 2, 1, 0, 0, 0)));
    });

    it('resyncs when the tab comes back to the foreground', () => {
        render(<Clock />);

        // Background tabs throttle timers to about one tick a minute, so jump
        // the wall clock forward the way a throttled tab experiences it.
        act(() => {
            vi.setSystemTime(new Date(2024, 0, 15, 9, 30, 45, 0));
        });
        expect(renderedTime()).toBe(formatExpected(new Date(2024, 0, 15, 9, 30, 15)));

        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(renderedTime()).toBe(formatExpected(new Date(2024, 0, 15, 9, 30, 45)));
    });

    it('resyncs when the window regains focus without a visibility change', () => {
        render(<Clock />);

        // A second window changing the clock, or a long sleep, moves the time
        // without this tab ever reporting a visibility change.
        act(() => {
            vi.setSystemTime(new Date(2024, 0, 15, 9, 30, 45, 0));
            window.dispatchEvent(new Event('focus'));
        });

        expect(renderedTime()).toBe(formatExpected(new Date(2024, 0, 15, 9, 30, 45)));
    });

    it('ignores a background visibility change', () => {
        const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        render(<Clock />);

        act(() => {
            vi.setSystemTime(new Date(2024, 0, 15, 9, 30, 45, 0));
            document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(renderedTime()).toBe(formatExpected(new Date(2024, 0, 15, 9, 30, 15)));
        visibilitySpy.mockRestore();
    });

    it('does not repaint when a resync lands inside the same displayed second', () => {
        render(<Clock />);
        const timer = screen.getByRole('timer', { name: 'Current time' });

        act(() => {
            vi.setSystemTime(new Date(2024, 0, 15, 9, 30, 15, 400));
            window.dispatchEvent(new Event('focus'));
        });

        // The displayed second is unchanged, so a repaint would be wasted work
        // on a component that is mounted above every page.
        expect(timer).toHaveTextContent(formatExpected(new Date(2024, 0, 15, 9, 30, 15)));
    });

    it('keeps only one timeout alive at a time', () => {
        render(<Clock />);
        expect(vi.getTimerCount()).toBe(1);

        act(() => {
            vi.advanceTimersByTime(10_000);
        });

        // The tick reschedules itself; a second chain would double the wakeups.
        expect(vi.getTimerCount()).toBe(1);
    });

    it('stops scheduling updates once unmounted', () => {
        const { unmount } = render(<Clock />);
        const clearSpy = vi.spyOn(window, 'clearTimeout');

        unmount();

        expect(clearSpy).toHaveBeenCalled();
        // A leaked timer would keep firing for the lifetime of the process.
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops scheduling even if the component unmounts right after a tick ran', () => {
        // The tick reschedules itself synchronously, before React flushes the
        // update it just queued. If a parent drops the clock in response to
        // that update, clearing the handle alone would leave the new timeout
        // dangling with nothing left to clear it.
        const { rerender, unmount } = render(<Clock />);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(vi.getTimerCount()).toBe(1);

        rerender(<div />);
        expect(vi.getTimerCount()).toBe(0);
        unmount();
    });

    it('leaves no listener behind that could repaint after unmount', () => {
        const { unmount } = render(<Clock />);
        unmount();

        act(() => {
            vi.setSystemTime(new Date(2024, 0, 15, 9, 31, 45, 0));
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
        });

        expect(vi.getTimerCount()).toBe(0);
    });
});
