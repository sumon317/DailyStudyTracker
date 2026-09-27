import type { TempTime } from '../types';

const TIME_VALUE_PATTERN = /^(\d{1,2}):(\d{1,2})$/;
const LEADING_DIGITS_PATTERN = /^\s*(\d{1,3})/;
const HOUR_MAX = 23;
const MINUTE_MAX = 59;

/**
 * A time that has never been set opens on a plausible study start rather than
 * on midnight, so "Set" does not silently create a 00:00 session.
 */
const UNSET_TEMP_TIME: TempTime = { h: 10, m: 0, period: 'AM' };
/**
 * A stored value that is present but has no readable time in it is repaired to
 * the start of the day, which is the only time every consumer agrees on.
 */
const CORRUPT_TEMP_TIME: TempTime = { h: 12, m: 0, period: 'AM' };

const clamp = (value: number, max: number): number => (Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0);

const readField = (raw: string | undefined): number => {
    const match = LEADING_DIGITS_PATTERN.exec(raw ?? '');
    return match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
};

/**
 * Whether a stored value is a time this app can round-trip.
 *
 * One or two digits per field are accepted so a value written by an older
 * version ("9:30") still reads as a set time, but out-of-range fields do not:
 * "99:99" is corrupt data and must not be echoed back as if it were real.
 */
export const isValidTimeValue = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false;
    }

    const match = TIME_VALUE_PATTERN.exec(value);
    if (!match) {
        return false;
    }

    return Number(match[1]) <= HOUR_MAX && Number(match[2]) <= MINUTE_MAX;
};

/**
 * Repairs any stored value into 12-hour editor state. Out-of-range fields are
 * clamped rather than rejected, so corrupt data can still be corrected and
 * saved from the picker instead of being locked in place.
 */
export const parseTimeValue = (timeStr: string): TempTime => {
    if (!timeStr) {
        return { ...UNSET_TEMP_TIME };
    }

    const parts = timeStr.split(':');
    const rawHour = readField(parts[0]);
    if (Number.isNaN(rawHour)) {
        return { ...CORRUPT_TEMP_TIME };
    }

    const hour = clamp(rawHour, HOUR_MAX);
    const minute = clamp(readField(parts[1]), MINUTE_MAX);
    return {
        h: hour % 12 || 12,
        m: minute,
        period: hour >= 12 ? 'PM' : 'AM',
    };
};

/**
 * Human readable 12-hour form of a stored value, or an empty string when the
 * value cannot be shown as it is stored so the caller can show its placeholder.
 */
export const formatTimeValue = (value: string): string => {
    if (!isValidTimeValue(value)) {
        return '';
    }

    const { h, m, period } = parseTimeValue(value);
    return `${h}:${String(m).padStart(2, '0')} ${period}`;
};
