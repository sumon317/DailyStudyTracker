import { describe, expect, it } from 'vitest';
import type { DayData, Subject } from '../../types';
import {
    completionPercentage,
    completionRatio,
    dayTotals,
    formatHours,
    formatMinutes,
    longestStudiedStreak,
    subjectTotals,
    toMinutes,
} from './metrics';

const subject = (planned: string, actual: string): Subject => ({
    id: 1,
    name: 'Accounts',
    planned,
    actual,
    kpi: 'N',
    time: '',
    reminder: false,
});

const day = (date: string, subjects: Subject[]): DayData => ({
    date,
    updatedAt: `${date}T00:00:00.000Z`,
    subjects,
    checklistItems: [],
    qualityChecks: [],
    dayRating: '',
    errors: [],
});

describe('toMinutes', () => {
    it('keeps finite, positive values from either representation', () => {
        expect(toMinutes('60')).toBe(60);
        expect(toMinutes('45.5')).toBe(45.5);
        expect(toMinutes(30)).toBe(30);
    });

    it('treats anything that is not a finite, non-negative number as no minutes', () => {
        // `-5` and `1e999` are both typeable into `<input type="number" min="0">`,
        // and the browser only marks them invalid rather than blocking them.
        for (const value of ['1e999', '-60', 'abc', '', '  ', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(toMinutes(value)).toBe(0);
        }
    });
});

describe('formatMinutes', () => {
    it('drops a pointless trailing decimal', () => {
        expect(formatMinutes(60)).toBe('60');
        expect(formatMinutes(45.5)).toBe('45.5');
        expect(formatMinutes(45.04)).toBe('45');
    });

    it('never renders a non-finite value as text', () => {
        // `toFixed` on NaN or Infinity produces those literals, which would put
        // "NaN" straight into the UI from a single bad stored value.
        expect(formatMinutes(Number.NaN)).toBe('0');
        expect(formatMinutes(Number.POSITIVE_INFINITY)).toBe('0');
    });
});

describe('formatHours', () => {
    it('renders tenths of an hour and rounds away the rest', () => {
        expect(formatHours(90)).toBe('1.5h');
        expect(formatHours(60)).toBe('1h');
        expect(formatHours(45)).toBe('0.8h');
    });

    it('rounds every tie the same way', () => {
        // The pin on the rounding contract. Dividing by 60 and multiplying by 10
        // turns an exact half into a value just below it, so 9 minutes - 0.15h,
        // exactly 1.5 tenths - rendered as `0.1h` while 45 minutes - 0.75h,
        // exactly 7.5 tenths - rendered as `0.8h`. Two ties, opposite answers,
        // and which one a day's total came out as depended on the binary
        // representation of the division.
        expect(formatHours(3)).toBe('0.1h');
        expect(formatHours(9)).toBe('0.2h');
        expect(formatHours(15)).toBe('0.3h');
        expect(formatHours(45)).toBe('0.8h');
        expect(formatHours(75)).toBe('1.3h');
        expect(formatHours(105)).toBe('1.8h');
        expect(formatHours(135)).toBe('2.3h');
    });

    it('rounds rather than truncates a total that is not a whole number of tenths', () => {
        // 75 minutes is 1.25h. Truncating would report `1.2h`, understating the
        // plan by three minutes for no stated reason.
        expect(formatHours(75)).toBe('1.3h');
        expect(formatHours(44)).toBe('0.7h');
        expect(formatHours(46)).toBe('0.8h');
    });

    it('refuses an unusable minute count', () => {
        expect(formatHours(Number.NaN)).toBe('0h');
        expect(formatHours('1e999' as unknown as number)).toBe('0h');
        expect(formatHours(-30)).toBe('0h');
    });
});

describe('completionRatio', () => {
    it('reports the true ratio with no upper bound', () => {
        expect(completionRatio(45, 60)).toBe(75);
        // 90 of 30 is 300%. Rounding that down to 100% would state that a
        // 60 minute overshoot exactly met the plan.
        expect(completionRatio(90, 30)).toBe(300);
    });

    it('rounds to a whole percent', () => {
        expect(completionRatio(1, 3)).toBe(33);
        expect(completionRatio(2, 3)).toBe(67);
    });

    it('has nothing to report against a plan of zero', () => {
        expect(completionRatio(45, 0)).toBe(0);
        expect(completionRatio(0, 0)).toBe(0);
        expect(completionRatio(45, -10)).toBe(0);
    });
});

describe('completionPercentage', () => {
    it('caps at 100 for the progress bar and the bar height', () => {
        // `aria-valuenow` is announced against `aria-valuemax`, and a bar cannot
        // be taller than its track, so the geometry has to stop at 100.
        expect(completionPercentage(90, 30)).toBe(100);
        expect(completionPercentage(45, 60)).toBe(75);
    });

    it('agrees with the uncapped ratio below the cap', () => {
        const underCap: Array<[number, number]> = [
            [0, 60],
            [30, 60],
            [60, 60],
        ];
        for (const [actual, planned] of underCap) {
            expect(completionPercentage(actual, planned)).toBe(completionRatio(actual, planned));
        }
    });
});

describe('subjectTotals', () => {
    it('sums planned and actual minutes across a day', () => {
        expect(subjectTotals([subject('60', '45'), subject('90', '30')])).toEqual({ actual: 75, planned: 150 });
    });

    it('reports no plan for a day that has not been recorded', () => {
        expect(subjectTotals(undefined)).toEqual({ actual: 0, planned: 0 });
        expect(subjectTotals(null)).toEqual({ actual: 0, planned: 0 });
        expect(subjectTotals([])).toEqual({ actual: 0, planned: 0 });
    });

    it('refuses a non-array payload instead of throwing', () => {
        expect(subjectTotals({} as unknown as Subject[])).toEqual({ actual: 0, planned: 0 });
    });

    it('drops unusable minute values rather than poisoning the total', () => {
        // Each field is guarded on its own: a bad plan must not erase the good
        // actual beside it, and one bad record must not turn the day into NaN.
        expect(subjectTotals([subject('1e999', '60'), subject('90', 'abc')])).toEqual({ actual: 60, planned: 90 });
    });
});

describe('dayTotals', () => {
    it('answers the same way for a missing day as every chart consumer needs', () => {
        // A day with no record has no plan. The bar chart, the table and the
        // stat cards all used to disagree here, with the chart inventing a plan.
        expect(dayTotals(undefined)).toEqual({ actual: 0, planned: 0 });
        expect(dayTotals(null)).toEqual({ actual: 0, planned: 0 });
        expect(dayTotals({ ...day('2024-01-15', []), subjects: [] })).toEqual({ actual: 0, planned: 0 });
    });

    it('reads the totals off the day it is given', () => {
        expect(dayTotals(day('2024-01-15', [subject('60', '30')]))).toEqual({ actual: 30, planned: 60 });
    });
});

describe('longestStudiedStreak', () => {
    it('is zero with nothing studied', () => {
        expect(longestStudiedStreak([])).toBe(0);
    });

    it('counts one unbroken run', () => {
        expect(longestStudiedStreak(['2024-01-14', '2024-01-15', '2024-01-16'])).toBe(3);
    });

    it('ends a run at a gap and reports the longest one', () => {
        // Two days, a gap, then three: the best run in the list is the last one.
        expect(longestStudiedStreak(['2024-01-14', '2024-01-15', '2024-01-17', '2024-01-18', '2024-01-19'])).toBe(3);
    });

    it('counts a single studied day as a one-day streak', () => {
        expect(longestStudiedStreak(['2024-01-15'])).toBe(1);
    });

    it('crosses a month and a year boundary in local time', () => {
        expect(longestStudiedStreak(['2023-12-30', '2023-12-31', '2024-01-01'])).toBe(3);
        expect(longestStudiedStreak(['2024-01-31', '2024-02-01'])).toBe(2);
    });

    it('crosses a leap day without a phantom gap', () => {
        // 2024 is a leap year, so Feb 29 exists and Feb 29 -> Mar 1 is adjacent.
        expect(longestStudiedStreak(['2024-02-28', '2024-02-29', '2024-03-01'])).toBe(3);
    });

    it('never invents a streak across a real gap', () => {
        // Mar 1 -> Mar 3 skips Mar 2, so the run has to break rather than treat
        // the missing day as studied. In a non-leap year Feb 28 -> Mar 1 is
        // genuinely adjacent and must not be broken.
        expect(longestStudiedStreak(['2024-03-01', '2024-03-03'])).toBe(1);
        expect(longestStudiedStreak(['2023-02-28', '2023-03-01'])).toBe(2);
    });

    it('breaks a run at an unparseable key', () => {
        expect(longestStudiedStreak(['2024-01-14', '2024-02-30', '2024-01-15'])).toBe(1);
    });
});
