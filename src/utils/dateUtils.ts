const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_DATE_KEY_YEAR = 1;
const MAX_DATE_KEY_YEAR = 9999;

const isLeapYear = (year: number): boolean => {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
};

const getDaysInMonth = (year: number, month: number): number => {
    if (month === 2) {
        return isLeapYear(year) ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

/**
 * Builds the local day for `year`/`monthIndex`/`day` without going through the
 * `Date` constructor or `Date.UTC`.
 *
 * Both of those remap years 0-99 into the 1900s and pin the result to UTC, so
 * the calendar fields are set on an existing local date instead. On the rare
 * days where a zone skips midnight the result is the first instant that does
 * exist (01:00), which is still the requested calendar day.
 */
const createLocalDate = (year: number, monthIndex: number, day: number): Date => {
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, monthIndex, day);
    return date;
};

const pad = (value: number, length: number): string => {
    return String(value).padStart(length, '0');
};

export const formatLocalDate = (date: Date | null | undefined): string => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return '';
    }

    const year = date.getFullYear();
    const yearText = year < 0 ? `-${pad(Math.abs(year), 4)}` : pad(year, 4);

    return `${yearText}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
};

export const isValidDateKey = (dateKey: unknown): dateKey is string => {
    if (typeof dateKey !== 'string') {
        return false;
    }

    const match = DATE_KEY_PATTERN.exec(dateKey);
    if (!match) {
        return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (year < MIN_DATE_KEY_YEAR || year > MAX_DATE_KEY_YEAR) {
        return false;
    }

    return month >= 1 && month <= 12 && day >= 1 && day <= getDaysInMonth(year, month);
};

export const parseLocalDate = (dateKey: unknown): Date | null => {
    if (!isValidDateKey(dateKey)) {
        return null;
    }

    const year = Number(dateKey.slice(0, 4));
    const month = Number(dateKey.slice(5, 7));
    const day = Number(dateKey.slice(8, 10));
    const date = createLocalDate(year, month - 1, day);

    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return date;
};

export const getTodayLocalDate = (): string => {
    return formatLocalDate(new Date());
};

export const addLocalDays = (dateKey: unknown, amount: number): string | null => {
    const date = parseLocalDate(dateKey);
    if (!date || !Number.isInteger(amount)) {
        return null;
    }

    date.setDate(date.getDate() + amount);
    const result = formatLocalDate(date);
    return isValidDateKey(result) ? result : null;
};

export const getLocalWeekDates = (dateKey: unknown): string[] => {
    const date = parseLocalDate(dateKey);
    if (!date) {
        return [];
    }

    const dates: string[] = [];
    for (let offset = -date.getDay(); offset < 7 - date.getDay(); offset += 1) {
        const weekDate = addLocalDays(dateKey, offset);
        if (weekDate === null) {
            return [];
        }
        // Zero-padded keys compare the same way as the dates they name, so a
        // repeated key means the step did not actually advance a day. That
        // happens where a zone skipped a whole calendar day at a dateline
        // change (Samoa dropped 2011-12-30, Kiribati dropped 1994-12-31):
        // without this the week would come back as seven entries with one day
        // doubled and another missing, which reads as a study day recorded
        // twice. A week that cannot be named day by day is reported as absent,
        // the same way an out-of-range week already is.
        const previous = dates[dates.length - 1];
        if (previous !== undefined && weekDate <= previous) {
            return [];
        }
        dates.push(weekDate);
    }

    return dates;
};

/**
 * Number of days in a local month, or 0 when the fields do not describe a real
 * month. Callers building a calendar grid should use this instead of
 * `new Date(year, month + 1, 0)`, which silently maps years 0-99 onto 1900-1999.
 */
export const getDaysInLocalMonth = (year: number, monthIndex: number): number => {
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) {
        return 0;
    }
    if (year < MIN_DATE_KEY_YEAR || year > MAX_DATE_KEY_YEAR || monthIndex < 0 || monthIndex > 11) {
        return 0;
    }
    return getDaysInMonth(year, monthIndex + 1);
};

/**
 * Date key for the first day of the local month that `dateKey` falls in.
 */
export const getMonthKey = (dateKey: unknown): string | null => {
    const date = parseLocalDate(dateKey);
    if (!date) {
        return null;
    }
    return formatLocalDate(createLocalDate(date.getFullYear(), date.getMonth(), 1));
};

/**
 * Date key for local calendar fields, or null when they do not describe a real
 * day. The counterpart of {@link parseLocalDate} for callers that are holding
 * year/month/day numbers rather than a key already.
 */
export const localDateKeyFromParts = (year: number, monthIndex: number, day: number): string | null => {
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) {
        return null;
    }

    const date = createLocalDate(year, monthIndex, day);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
        return null;
    }

    const key = formatLocalDate(date);
    return isValidDateKey(key) ? key : null;
};

/**
 * Moves a date key to the same day-of-month in a neighbouring month, clamping
 * to the last day when the target month is shorter (Jan 31 -> Feb 29).
 */
export const shiftMonthKey = (dateKey: unknown, amount: number): string | null => {
    const date = parseLocalDate(dateKey);
    if (!date || !Number.isInteger(amount)) {
        return null;
    }

    const shifted = new Date(date.getTime());
    shifted.setDate(1);
    shifted.setMonth(shifted.getMonth() + amount);
    if (Number.isNaN(shifted.getTime())) {
        return null;
    }

    const year = shifted.getFullYear();
    const month = shifted.getMonth();
    const day = Math.min(date.getDate(), getDaysInMonth(year, month + 1));
    const key = formatLocalDate(createLocalDate(year, month, day));
    return isValidDateKey(key) ? key : null;
};
