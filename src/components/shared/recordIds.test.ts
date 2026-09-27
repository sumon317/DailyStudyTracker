import { afterEach, describe, expect, it, vi } from 'vitest';
import { reserveRecordId } from './recordIds';

const freezeClock = (iso = '2024-01-15T08:00:00') => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
};

describe('reserveRecordId', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('mints an id just past the wall clock when nothing is taken', () => {
        freezeClock();

        expect(reserveRecordId(0, [])).toBe(Date.now() + 1);
    });

    it('keeps advancing past the last id it handed out', () => {
        freezeClock();
        const first = reserveRecordId(0, []);
        const second = reserveRecordId(first, [first]);

        expect(second).toBe(first + 1);
    });

    it('steps off an id that is already in use', () => {
        freezeClock();
        // A backup can carry ids minted at the same instant as the current
        // clock, so the clock-derived candidate can genuinely collide.
        const candidate = Date.now() + 1;

        expect(reserveRecordId(Date.now(), [candidate - 1, candidate, candidate + 1])).toBe(candidate + 2);
    });

    it('does not repeat an id when the wall clock has not moved', () => {
        // Two adds inside one millisecond is the case a bare `Date.now()` seed
        // gets wrong; the clock is frozen so the test really exercises it.
        freezeClock();
        const first = reserveRecordId(Date.now(), []);
        const second = reserveRecordId(first, [first]);

        expect(second).not.toBe(first);
        expect(second).toBe(first + 1);
    });

    it('steps off the safe-integer ceiling instead of repeating', () => {
        // `storage.ts` accepts ids up to `Number.MAX_SAFE_INTEGER` and its own
        // suite round-trips exactly that value, so a backup can put the list
        // there. `MAX + 1` is the first float past the safe range and adding to
        // *it* rounds back to itself, which is how the old `lastId + 1` seed
        // handed two consecutive rows the same id.
        freezeClock();
        const ceiling = Number.MAX_SAFE_INTEGER;

        const first = reserveRecordId(ceiling, [ceiling]);
        const second = reserveRecordId(first, [ceiling, first]);

        expect(first).not.toBe(ceiling);
        expect(second).not.toBe(first);
        expect(Number.isSafeInteger(first)).toBe(true);
        expect(Number.isSafeInteger(second)).toBe(true);
    });

    it('keeps stepping while the clock-derived candidate is taken', () => {
        freezeClock();
        const candidate = Date.now() + 1;
        const taken = [candidate, candidate + 1, candidate + 2];

        expect(reserveRecordId(Date.now(), taken)).toBe(candidate + 3);
    });

    it('wraps rather than looping forever on a fully packed low range', () => {
        // `n` ids taken always leave one of `1..n + 1` free, so the walk is
        // bounded; this pins the bound rather than trusting it.
        freezeClock();
        const taken = Array.from({ length: 50 }, (_, index) => index + 1);

        expect(reserveRecordId(Number.MAX_SAFE_INTEGER, taken)).toBe(51);
    });
});
