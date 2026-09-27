import type { DayData, Subject } from '../../types';
import { addLocalDays } from '../../utils/dateUtils';

/**
 * Minutes arrive here straight from a free-text `<input type="number">`, where
 * both `-5` and `1e999` are typeable and neither is blocked by the field's
 * `min`/`max` (the browser only marks them invalid). `Number.parseFloat` keeps
 * `Infinity` because it is truthy, and keeps negatives, so every read of a
 * stored minute value goes through this one guard: anything that is not a
 * finite, non-negative number counts as no minutes at all.
 */
export const toMinutes = (value: string | number | null | undefined): number => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return parsed;
};

/**
 * Renders a minute count for display, dropping a pointless trailing `.0`.
 *
 * `toFixed` on `NaN`/`Infinity` yields the literal strings `"NaN"` and
 * `"Infinity"`, so the guard is here rather than left to every call site: a
 * single unguarded number would otherwise be printed straight into the UI.
 */
export const formatMinutes = (value: number): string => {
    if (!Number.isFinite(value)) {
        return '0';
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
};

/**
 * Tenth-of-an-hour rendering (`1.5h`), rounded half-up.
 *
 * The contract is stated here because it used to be an accident of arithmetic
 * order. Dividing by 60 and then multiplying by 10 turns an exact half into a
 * value just *below* it: 9 minutes is 0.15h, which is exactly 1.5 tenths in
 * decimal but `0.15 * 10` is `1.4999999999999998` in binary, so it rendered as
 * `0.1h` - while 45 minutes, 0.75h and exactly 7.5 tenths, rendered as `0.8h`.
 * Two ties, rounded opposite ways, and which one a day's total came out as
 * depended on how the division happened to land in binary. Dividing by six (an
 * hour is 60 minutes, a tenth of one is 6) keeps every true tie on the same side
 * of the boundary, and the rounding is then plainly `Math.round`.
 *
 * Rounded to the nearest tenth, not truncated: 75 minutes is 1.25h and reports
 * `1.3h`, which is what a reader expects from a one-decimal figure.
 */
export const formatHours = (minutes: number): string => `${Math.round(toMinutes(minutes) / 6) / 10}h`;

/**
 * Completion as a whole percent, with no upper bound: studying 90 minutes
 * against a 30 minute plan is 300%, and the data table and the progress bar's
 * value text both need to be able to say so. A plan of zero has no completion
 * to report, so it returns 0 instead of dividing by it.
 */
export const completionRatio = (actual: number, planned: number): number => {
    const safeActual = toMinutes(actual);
    const safePlanned = toMinutes(planned);
    if (safePlanned <= 0) {
        return 0;
    }
    return Math.round((safeActual / safePlanned) * 100);
};

/**
 * Completion as a whole percent, capped at 100 because every consumer is a
 * progress bar or a bar height - a `progressbar` announces `aria-valuenow`
 * against `aria-valuemax`, and a bar cannot be taller than its track. Use
 * {@link completionRatio} wherever the number is reported as data instead.
 */
export const completionPercentage = (actual: number, planned: number): number =>
    Math.min(completionRatio(actual, planned), 100);

export interface DayTotals {
    actual: number;
    planned: number;
}

export const subjectTotals = (subjects: Subject[] | null | undefined): DayTotals => {
    if (!Array.isArray(subjects)) {
        return { actual: 0, planned: 0 };
    }
    return subjects.reduce<DayTotals>(
        (totals, subject) => ({
            actual: totals.actual + toMinutes(subject?.actual),
            planned: totals.planned + toMinutes(subject?.planned),
        }),
        { actual: 0, planned: 0 },
    );
};

/**
 * One place to answer "how much was studied on this day".
 *
 * The bar chart, the screen-reader table and the stat cards each used to reduce
 * the same record with a different fallback (`|| 360`, `?? 0`, and a truthiness
 * guard), so a missing day was simultaneously "360 minutes planned" on screen
 * and "0 minutes planned" in the table. A day without a record has no plan, and
 * now every consumer agrees on that.
 */
export const dayTotals = (day: DayData | null | undefined): DayTotals => subjectTotals(day?.subjects);

/**
 * Longest run of consecutive calendar days in `dates`, which must already be
 * sorted ascending. Gaps and unparseable keys both end a run, so a corrupt
 * record cannot invent a streak.
 */
export const longestStudiedStreak = (dates: string[]): number => {
    let longest = 0;
    let run = 0;
    dates.forEach((dateStr, index) => {
        const previous = dates[index - 1];
        run = previous !== undefined && addLocalDays(previous, 1) === dateStr ? run + 1 : 1;
        longest = Math.max(longest, run);
    });
    return longest;
};
