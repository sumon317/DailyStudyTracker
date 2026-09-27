import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    addLocalDays,
    formatLocalDate,
    getDaysInLocalMonth,
    getLocalWeekDates,
    getMonthKey,
    getTodayLocalDate,
    isValidDateKey,
    localDateKeyFromParts,
    parseLocalDate,
    shiftMonthKey,
} from './dateUtils';

const setTimeZone = (timeZone: string): void => {
    vi.stubEnv('TZ', timeZone);
};

const localKeyFromDate = (date: Date): string => {
    return [
        String(date.getFullYear()).padStart(4, '0'),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
};

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

describe('local date utilities', () => {
    it('formats UTC and IST boundary instants using local calendar fields', () => {
        const boundaryInstant = new Date('2024-01-01T23:30:00.000Z');

        setTimeZone('UTC');
        expect(formatLocalDate(boundaryInstant)).toBe('2024-01-01');

        setTimeZone('Asia/Kolkata');
        expect(formatLocalDate(boundaryInstant)).toBe('2024-01-02');
        expect(formatLocalDate(boundaryInstant)).toBe(localKeyFromDate(boundaryInstant));
    });

    it('parses a date key at local midnight without UTC conversion', () => {
        for (const timeZone of ['UTC', 'Asia/Kolkata']) {
            setTimeZone(timeZone);
            const parsed = parseLocalDate('2024-01-01');

            expect(parsed).not.toBeNull();
            expect(parsed?.getFullYear()).toBe(2024);
            expect(parsed?.getMonth()).toBe(0);
            expect(parsed?.getDate()).toBe(1);
            expect(parsed?.getHours()).toBe(0);
            expect(formatLocalDate(parsed)).toBe('2024-01-01');
        }
    });

    it('rejects malformed, impossible, and null date keys without rollover', () => {
        expect(isValidDateKey('2024-02-29')).toBe(true);
        expect(isValidDateKey('2023-02-28')).toBe(true);

        const invalidKeys: unknown[] = [
            null,
            undefined,
            '',
            '2024-1-01',
            '2024-01-1',
            '2024-02-30',
            '2023-02-29',
            '2024-13-01',
            '2024-00-10',
            '2024-01-00',
            '2024-01-01T00:00:00.000Z',
            ' 2024-01-01',
            20240101,
        ];

        for (const dateKey of invalidKeys) {
            expect(isValidDateKey(dateKey)).toBe(false);
            expect(parseLocalDate(dateKey)).toBeNull();
        }

        expect(addLocalDays('2024-02-30', 1)).toBeNull();
        expect(getLocalWeekDates('2024-02-30')).toEqual([]);
    });

    it('handles leap-day and local date arithmetic in both directions', () => {
        expect(addLocalDays('2024-02-28', 1)).toBe('2024-02-29');
        expect(addLocalDays('2024-02-29', 1)).toBe('2024-03-01');
        expect(addLocalDays('2024-03-01', -1)).toBe('2024-02-29');
        expect(addLocalDays('2023-02-28', 1)).toBe('2023-03-01');
        expect(addLocalDays('2024-01-01', -1)).toBe('2023-12-31');
        expect(addLocalDays('2024-01-01', 0)).toBe('2024-01-01');
        expect(addLocalDays('2024-01-01', 1.5)).toBeNull();
    });

    it('returns Sunday-first week dates across month and year boundaries', () => {
        const expected = [
            '2023-12-31',
            '2024-01-01',
            '2024-01-02',
            '2024-01-03',
            '2024-01-04',
            '2024-01-05',
            '2024-01-06',
        ];

        expect(getLocalWeekDates('2024-01-01')).toEqual(expected);
        expect(getLocalWeekDates('2024-01-07')).toEqual([
            '2024-01-07',
            '2024-01-08',
            '2024-01-09',
            '2024-01-10',
            '2024-01-11',
            '2024-01-12',
            '2024-01-13',
        ]);
        expect(getLocalWeekDates('2024-01-13')).toEqual([
            '2024-01-07',
            '2024-01-08',
            '2024-01-09',
            '2024-01-10',
            '2024-01-11',
            '2024-01-12',
            '2024-01-13',
        ]);
    });

    it('uses the local current day for today', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 0, 2, 12, 0, 0, 0));
        expect(getTodayLocalDate()).toBe('2024-01-02');
    });

    it('returns an empty formatted key for invalid date values', () => {
        expect(formatLocalDate(null)).toBe('');
        expect(formatLocalDate(new Date('invalid'))).toBe('');
    });

    it('does not remap small years into the 1900s', () => {
        // Both `new Date(5, ...)` and `Date.UTC(5, ...)` mean 1905, so the
        // helper has to set the fields on an existing local date instead.
        expect(isValidDateKey('0005-06-07')).toBe(true);
        expect(formatLocalDate(parseLocalDate('0005-06-07'))).toBe('0005-06-07');
        expect(localDateKeyFromParts(5, 5, 7)).toBe('0005-06-07');
    });

    it('formats a pre-year-zero date with a signed year', () => {
        const beforeCommonEra = new Date(0);
        beforeCommonEra.setHours(0, 0, 0, 0);
        beforeCommonEra.setFullYear(-1, 0, 5);

        expect(formatLocalDate(beforeCommonEra)).toBe('-0001-01-05');
        // A negative year is not a date key this app stores.
        expect(isValidDateKey(formatLocalDate(beforeCommonEra))).toBe(false);
    });

    it('refuses keys and field values outside years 1-9999', () => {
        expect(isValidDateKey('0000-01-01')).toBe(false);
        expect(isValidDateKey('9999-12-31')).toBe(true);
        expect(isValidDateKey('10000-01-01')).toBe(false);
        expect(localDateKeyFromParts(0, 0, 1)).toBeNull();
        expect(localDateKeyFromParts(10_000, 0, 1)).toBeNull();
    });

    it('applies the full leap year rule, not just divisibility by four', () => {
        // 1900 and 2100 are divisible by four but are not leap years; 2000 is.
        expect(isValidDateKey('2000-02-29')).toBe(true);
        expect(isValidDateKey('1900-02-29')).toBe(false);
        expect(isValidDateKey('2100-02-29')).toBe(false);
        expect(isValidDateKey('2024-02-29')).toBe(true);
        expect(isValidDateKey('2023-02-29')).toBe(false);

        expect(getDaysInLocalMonth(2000, 1)).toBe(29);
        expect(getDaysInLocalMonth(1900, 1)).toBe(28);
        expect(getDaysInLocalMonth(2100, 1)).toBe(28);
        expect(getDaysInLocalMonth(2024, 1)).toBe(29);
        expect(getDaysInLocalMonth(2023, 1)).toBe(28);
    });

    it('gives every month its own length and rejects impossible field values', () => {
        const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
            expect(getDaysInLocalMonth(2023, monthIndex)).toBe(lengths[monthIndex]);
        }

        expect(getDaysInLocalMonth(2024, 12)).toBe(0);
        expect(getDaysInLocalMonth(2024, -1)).toBe(0);
        expect(getDaysInLocalMonth(0, 0)).toBe(0);
        expect(getDaysInLocalMonth(2024.5, 0)).toBe(0);
        expect(getDaysInLocalMonth(2024, 0.5)).toBe(0);
    });

    it('rejects field values that do not describe a real day', () => {
        expect(localDateKeyFromParts(2024, 0, 0)).toBeNull();
        expect(localDateKeyFromParts(2024, 0, 32)).toBeNull();
        expect(localDateKeyFromParts(2024, 12, 1)).toBeNull();
        expect(localDateKeyFromParts(2024, -1, 1)).toBeNull();
        expect(localDateKeyFromParts(2023, 1, 29)).toBeNull();
        expect(localDateKeyFromParts(2024, 1, 29)).toBe('2024-02-29');
        // A whole-number float is still a whole number.
        expect(localDateKeyFromParts(2024, 1.0, 29)).toBe('2024-02-29');
    });

    it('reads local midnight correctly across daylight saving transitions', () => {
        // These zones skip local midnight entirely on the spring forward, so
        // the first instant that does exist is 01:00 of the same calendar day.
        for (const timeZone of ['America/Santiago', 'America/Havana', 'America/Sao_Paulo']) {
            setTimeZone(timeZone);
            for (const key of ['2024-09-08', '2024-03-10', '2018-11-04']) {
                const parsed = parseLocalDate(key);
                expect(parsed, `${timeZone} ${key}`).not.toBeNull();
                expect(formatLocalDate(parsed)).toBe(key);
            }
        }
    });

    it('steps across daylight saving changes without skipping or repeating a day', () => {
        setTimeZone('America/New_York');
        // Clocks go forward on 2024-03-10 and back on 2024-11-03.
        expect(addLocalDays('2024-03-09', 1)).toBe('2024-03-10');
        expect(addLocalDays('2024-03-10', 1)).toBe('2024-03-11');
        expect(addLocalDays('2024-11-02', 1)).toBe('2024-11-03');
        expect(addLocalDays('2024-11-03', 1)).toBe('2024-11-04');

        // A southern-hemisphere zone transitions on the other side of the year.
        setTimeZone('Australia/Sydney');
        expect(addLocalDays('2024-04-06', 1)).toBe('2024-04-07');
        expect(addLocalDays('2024-10-05', 1)).toBe('2024-10-06');

        // A half-hour and a 45-minute offset must not shift the calendar day.
        for (const timeZone of ['Asia/Kolkata', 'Asia/Kathmandu', 'Australia/Lord_Howe']) {
            setTimeZone(timeZone);
            expect(addLocalDays('2024-06-15', 1), timeZone).toBe('2024-06-16');
        }
    });

    it('keeps the same result for day arithmetic in every zone', () => {
        const cases: [string, number][] = [
            ['2024-02-28', 1],
            ['2024-02-29', 1],
            ['2023-02-28', 1],
            ['2024-01-01', -1],
            ['2024-12-31', 1],
        ];
        const baseline = cases.map(([key, amount]) => addLocalDays(key, amount));

        for (const timeZone of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Apia', 'Pacific/Kiritimati']) {
            setTimeZone(timeZone);
            expect(
                cases.map(([key, amount]) => addLocalDays(key, amount)),
                timeZone,
            ).toEqual(baseline);
        }
    });

    it('refuses to step outside the representable calendar', () => {
        expect(addLocalDays('9999-12-31', 1)).toBeNull();
        expect(addLocalDays('0001-01-01', -1)).toBeNull();
        expect(addLocalDays('2024-01-01', 1e9)).toBeNull();
        expect(addLocalDays('2024-01-01', -1e9)).toBeNull();
        expect(addLocalDays('2024-01-01', Number.NaN)).toBeNull();
        expect(addLocalDays('2024-01-01', Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('names the first of the month a key falls in', () => {
        expect(getMonthKey('2024-02-15')).toBe('2024-02-01');
        expect(getMonthKey('2024-02-01')).toBe('2024-02-01');
        expect(getMonthKey('2024-02-29')).toBe('2024-02-01');
        expect(getMonthKey('9999-12-31')).toBe('9999-12-01');
        expect(getMonthKey('0001-01-01')).toBe('0001-01-01');
        expect(getMonthKey('2024-02-30')).toBeNull();
        expect(getMonthKey('nonsense')).toBeNull();
    });

    it('paging by months keeps the day of month, clamping to a shorter month', () => {
        expect(shiftMonthKey('2024-01-31', 1)).toBe('2024-02-29');
        expect(shiftMonthKey('2024-03-31', -1)).toBe('2024-02-29');
        expect(shiftMonthKey('2024-05-31', 1)).toBe('2024-06-30');
        expect(shiftMonthKey('2024-01-31', -1)).toBe('2023-12-31');
        expect(shiftMonthKey('2024-12-31', 1)).toBe('2025-01-31');
        expect(shiftMonthKey('2024-12-31', 12)).toBe('2025-12-31');
        expect(shiftMonthKey('2024-01-15', 4)).toBe('2024-05-15');
        expect(shiftMonthKey('2024-01-15', 0)).toBe('2024-01-15');
    });

    it('pages as a stepper, so a clamped step is not undone on the way back', () => {
        // Paging is deliberately not reversible: the day the user is looking at
        // after PageDown is the one PageUp counts back from. What matters is
        // that both steps land on a real day and keep their ordinal position.
        const forward = shiftMonthKey('2024-01-31', 1) as string;
        expect(forward).toBe('2024-02-29');
        expect(shiftMonthKey(forward, -1)).toBe('2024-01-29');
        // The original day is still reachable, one step at a time.
        expect(shiftMonthKey(shiftMonthKey('2024-01-29', 1) as string, -1)).toBe('2024-01-29');
    });

    it('paging by whole years clamps February 29 to February 28', () => {
        expect(shiftMonthKey('2024-02-29', 12)).toBe('2025-02-28');
        expect(shiftMonthKey('2024-02-29', 48)).toBe('2028-02-29');
        expect(shiftMonthKey('2024-02-29', -48)).toBe('2020-02-29');
    });

    it('refuses to page past either end of the calendar', () => {
        expect(shiftMonthKey('9999-12-31', 1)).toBeNull();
        expect(shiftMonthKey('0001-01-15', -1)).toBeNull();
        expect(shiftMonthKey('2024-01-15', 1e9)).toBeNull();
        expect(shiftMonthKey('2024-01-15', 1.5)).toBeNull();
        expect(shiftMonthKey('2024-02-30', 1)).toBeNull();
    });

    it('returns an empty week rather than a doubled day where a zone skipped a date', () => {
        // Samoa jumped the dateline and never had a 2011-12-30. Stepping onto it
        // lands on the 31st, so a naive Sunday-first walk would return seven
        // entries with 2011-12-31 listed twice and no 30th at all - which reads
        // as one study day recorded twice.
        setTimeZone('Pacific/Apia');
        expect(isValidDateKey('2011-12-30')).toBe(true);
        expect(parseLocalDate('2011-12-30')).toBeNull();
        expect(addLocalDays('2011-12-29', 1)).toBe('2011-12-31');
        expect(getLocalWeekDates('2011-12-28')).toEqual([]);
    });

    it('still returns seven distinct, ordered days when a skipped day leaves a gap', () => {
        // Kiribati skipped 1994-12-31, so the last slot of that week lands on
        // the 1st instead. A gap is representable and callers index the result
        // positionally, so the week stays usable; only a repeat is not.
        setTimeZone('Pacific/Kiritimati');
        expect(parseLocalDate('1994-12-31')).toBeNull();

        const week = getLocalWeekDates('1994-12-30');
        expect(week).toHaveLength(7);
        expect(new Set(week).size).toBe(7);
        expect([...week].sort()).toEqual(week);
        expect(week).toContain('1994-12-30');
        expect(week).not.toContain('1994-12-31');
    });

    it('returns the ordinary week in the same years in an unaffected zone', () => {
        setTimeZone('UTC');
        expect(getLocalWeekDates('2011-12-28')).toEqual([
            '2011-12-25',
            '2011-12-26',
            '2011-12-27',
            '2011-12-28',
            '2011-12-29',
            '2011-12-30',
            '2011-12-31',
        ]);
        expect(getLocalWeekDates('1994-12-30')).toEqual([
            '1994-12-25',
            '1994-12-26',
            '1994-12-27',
            '1994-12-28',
            '1994-12-29',
            '1994-12-30',
            '1994-12-31',
        ]);
    });

    it('returns an empty week when it would run past the representable calendar', () => {
        // Both of these weeks straddle the 1-9999 range, so no seven distinct
        // keys can name them.
        expect(getLocalWeekDates('9999-12-31')).toEqual([]);
        expect(getLocalWeekDates('0001-01-01')).toEqual([]);
    });

    it('always returns seven distinct days for a week inside the range', () => {
        for (let day = 0; day < 28; day += 1) {
            const key = `2024-02-${String(day + 1).padStart(2, '0')}`;
            const week = getLocalWeekDates(key);
            expect(week, key).toHaveLength(7);
            expect(new Set(week).size, key).toBe(7);
            expect(week, key).toContain(key);
        }
    });

    it('re-reads today from the wall clock, not from a cached value', () => {
        vi.useFakeTimers();
        // 23:59:30 local on the 15th, seen from a zone that is already on the
        // 16th: "today" is a local calendar question, not a UTC one.
        vi.setSystemTime(new Date('2024-01-15T23:59:30.000Z'));
        setTimeZone('UTC');
        expect(getTodayLocalDate()).toBe('2024-01-15');
        setTimeZone('Asia/Kolkata');
        expect(getTodayLocalDate()).toBe('2024-01-16');
        setTimeZone('America/New_York');
        expect(getTodayLocalDate()).toBe('2024-01-15');

        // And again a second later, once the local day really has rolled over.
        vi.setSystemTime(new Date('2024-01-15T23:59:30.500Z'));
        expect(getTodayLocalDate()).toBe('2024-01-15');
        vi.setSystemTime(new Date('2024-01-16T00:00:00.000Z'));
        setTimeZone('UTC');
        expect(getTodayLocalDate()).toBe('2024-01-16');
    });

    it('reads today at the exact moment of a leap day rollover', () => {
        vi.useFakeTimers();
        setTimeZone('UTC');
        vi.setSystemTime(new Date('2024-02-28T23:59:59.999Z'));
        expect(getTodayLocalDate()).toBe('2024-02-28');
        vi.setSystemTime(new Date('2024-02-29T00:00:00.000Z'));
        expect(getTodayLocalDate()).toBe('2024-02-29');
    });
});
