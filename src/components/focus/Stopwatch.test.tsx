import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stopwatch from './Stopwatch';

const setVisibility = (value: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
};

describe('Stopwatch', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
        setVisibility('visible');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const timer = () => screen.getByRole('timer');

    it('starts paused at zero', () => {
        render(<Stopwatch />);
        expect(timer()).toHaveTextContent('00:00:00');
        expect(timer()).toHaveAccessibleName('Stopwatch 00:00:00, paused');
    });

    it('accumulates across pause and resume instead of restarting', () => {
        render(<Stopwatch />);
        const start = screen.getByRole('button', { name: 'Start stopwatch' });

        fireEvent.click(start);
        act(() => {
            vi.advanceTimersByTime(4000);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Pause stopwatch' }));
        expect(timer()).toHaveTextContent('00:00:04');

        // Time spent paused must not be counted.
        act(() => {
            vi.advanceTimersByTime(10_000);
        });
        expect(timer()).toHaveTextContent('00:00:04');

        fireEvent.click(screen.getByRole('button', { name: 'Start stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(timer()).toHaveTextContent('00:00:07');
    });

    it('toggles exactly once per click even when two clicks land in the same tick', () => {
        render(<Stopwatch />);
        const start = screen.getByRole('button', { name: 'Start stopwatch' });

        fireEvent.click(start);
        fireEvent.click(start);
        act(() => {
            vi.advanceTimersByTime(2000);
        });

        // Two clicks are start-then-pause, so the elapsed time stays at zero rather
        // than the second click restarting the clock.
        expect(timer()).toHaveTextContent('00:00:00');
        expect(screen.getByRole('button', { name: 'Start stopwatch' })).toBeInTheDocument();
    });

    it('clears a running clock on reset and stops the interval', () => {
        render(<Stopwatch />);
        fireEvent.click(screen.getByRole('button', { name: 'Start stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(8000);
        });
        expect(timer()).toHaveTextContent('00:00:08');

        fireEvent.click(screen.getByRole('button', { name: 'Reset stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(timer()).toHaveTextContent('00:00:00');
        expect(timer()).toHaveAccessibleName('Stopwatch 00:00:00, paused');
    });

    it('restarts cleanly from zero after a reset', () => {
        render(<Stopwatch />);
        fireEvent.click(screen.getByRole('button', { name: 'Start stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(8000);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Reset stopwatch' }));
        fireEvent.click(screen.getByRole('button', { name: 'Start stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(timer()).toHaveTextContent('00:00:02');
    });

    it('ignores elapsed-time syncs that arrive after a pause', () => {
        render(<Stopwatch />);
        fireEvent.click(screen.getByRole('button', { name: 'Start stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(6000);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Pause stopwatch' }));

        act(() => {
            vi.setSystemTime(new Date('2024-01-01T01:00:00Z'));
        });
        fireEvent(document, new Event('visibilitychange'));

        expect(timer()).toHaveTextContent('00:00:06');
    });

    it('formats durations past an hour without truncating', () => {
        render(<Stopwatch />);
        fireEvent.click(screen.getByRole('button', { name: 'Start stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(3_723_000);
        });
        expect(timer()).toHaveTextContent('1:02:03');
    });

    it('catches up on the wall clock when the app comes back to the foreground', () => {
        render(<Stopwatch />);
        fireEvent.click(screen.getByRole('button', { name: 'Start stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(timer()).toHaveTextContent('00:00:01');

        // A backgrounded tab has its interval throttled, so the clock has to be
        // re-derived from the wall clock rather than trusted from the last tick.
        act(() => {
            vi.setSystemTime(new Date('2024-01-01T00:05:00Z'));
        });
        setVisibility('hidden');
        fireEvent(document, new Event('visibilitychange'));

        expect(timer()).toHaveTextContent('00:05:00');
        expect(timer()).toHaveAccessibleName('Stopwatch 00:05:00, running');
    });

    it('stops its interval when it unmounts while running', () => {
        const clearInterval = vi.spyOn(window, 'clearInterval');
        const { unmount } = render(<Stopwatch />);
        fireEvent.click(screen.getByRole('button', { name: 'Start stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(1000);
        });

        unmount();
        expect(clearInterval).toHaveBeenCalled();
        clearInterval.mockRestore();
    });
});
