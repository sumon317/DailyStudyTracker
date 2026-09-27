import { describe, expect, it } from 'vitest';
import { formatTimeValue, isValidTimeValue, parseTimeValue } from './timeUtils';

describe('isValidTimeValue', () => {
    it('accepts the zero padded form the picker writes', () => {
        for (const value of ['00:00', '09:30', '23:59', '12:00', '10:05']) {
            expect(isValidTimeValue(value)).toBe(true);
        }
    });

    it('accepts the single digit form an older version may have stored', () => {
        // Both fields are read back as a set time rather than discarded.
        expect(isValidTimeValue('9:30')).toBe(true);
        expect(isValidTimeValue('0:0')).toBe(true);
    });

    it('rejects out-of-range fields instead of echoing corrupt data back', () => {
        for (const value of ['99:99', '24:00', '23:60', '100:00', '00:99']) {
            expect(isValidTimeValue(value)).toBe(false);
        }
    });

    it('rejects anything that is not a bare time', () => {
        for (const value of [
            '',
            ' 09:30',
            '09:30 ',
            '09:30:00',
            '-5:30',
            '+9:30',
            '9',
            '::',
            ':30',
            '09:',
            'not-a-time',
            '09:3O',
        ]) {
            expect(isValidTimeValue(value)).toBe(false);
        }
    });

    it('rejects non-strings, including digit homoglyphs', () => {
        for (const value of [null, undefined, 930, 930n, { hours: 9 }, ['09:30'], true]) {
            expect(isValidTimeValue(value)).toBe(false);
        }
        // Arabic-Indic digits look identical to a reader but are not `\d`, so a
        // value using them must not be treated as a time this app can parse.
        expect(isValidTimeValue('٠٩:٣٠')).toBe(false);
    });
});

describe('parseTimeValue', () => {
    it('opens an unset time on a plausible study start rather than midnight', () => {
        // "Set" must not silently create a 00:00 session.
        expect(parseTimeValue('')).toEqual({ h: 10, m: 0, period: 'AM' });
    });

    it('repairs a present but unreadable value to the start of the day', () => {
        for (const value of ['not-a-time', 'abc:def', '-5:30', '::']) {
            expect(parseTimeValue(value)).toEqual({ h: 12, m: 0, period: 'AM' });
        }
    });

    it('clamps out-of-range fields so corrupt data can still be corrected', () => {
        expect(parseTimeValue('99:99')).toEqual({ h: 11, m: 59, period: 'PM' });
        // 24 and 100 both clamp down to the last real hour rather than wrapping.
        expect(parseTimeValue('24:00')).toEqual({ h: 11, m: 0, period: 'PM' });
        expect(parseTimeValue('23:60')).toEqual({ h: 11, m: 59, period: 'PM' });
        // Three digits is not a time either, but the leading pair is still
        // clamped rather than discarded.
        expect(parseTimeValue('123:45')).toEqual({ h: 11, m: 45, period: 'PM' });
    });

    it('treats a bare hour as that hour on the hour', () => {
        expect(parseTimeValue('9')).toEqual({ h: 9, m: 0, period: 'AM' });
        expect(parseTimeValue('21')).toEqual({ h: 9, m: 0, period: 'PM' });
    });

    it('converts midnight and noon to the right 12-hour period', () => {
        expect(parseTimeValue('00:00')).toEqual({ h: 12, m: 0, period: 'AM' });
        expect(parseTimeValue('00:30')).toEqual({ h: 12, m: 30, period: 'AM' });
        expect(parseTimeValue('12:00')).toEqual({ h: 12, m: 0, period: 'PM' });
        expect(parseTimeValue('12:45')).toEqual({ h: 12, m: 45, period: 'PM' });
    });

    it('maps every hour of the day onto 1-12 with the right period', () => {
        for (let hour = 0; hour < 24; hour += 1) {
            const parsed = parseTimeValue(`${String(hour).padStart(2, '0')}:00`);
            expect(parsed.h).toBe(hour % 12 === 0 ? 12 : hour % 12);
            expect(parsed.period).toBe(hour >= 12 ? 'PM' : 'AM');
        }
    });

    it('always returns a value the picker can save without further clamping', () => {
        for (const value of ['', '99:99', 'not-a-time', '0:0', '23:59', '9']) {
            const { h, m, period } = parseTimeValue(value);
            expect(h).toBeGreaterThanOrEqual(1);
            expect(h).toBeLessThanOrEqual(12);
            expect(m).toBeGreaterThanOrEqual(0);
            expect(m).toBeLessThanOrEqual(59);
            expect(period === 'AM' || period === 'PM').toBe(true);
        }
    });

    it('does not hand back the shared defaults as a mutable reference', () => {
        const first = parseTimeValue('');
        first.h = 3;
        expect(parseTimeValue('')).toEqual({ h: 10, m: 0, period: 'AM' });
    });
});

describe('formatTimeValue', () => {
    it('renders a stored value as readable 12-hour time', () => {
        expect(formatTimeValue('09:30')).toBe('9:30 AM');
        expect(formatTimeValue('00:00')).toBe('12:00 AM');
        expect(formatTimeValue('00:05')).toBe('12:05 AM');
        expect(formatTimeValue('12:00')).toBe('12:00 PM');
        expect(formatTimeValue('14:05')).toBe('2:05 PM');
        expect(formatTimeValue('23:59')).toBe('11:59 PM');
        // The lenient single digit form still renders padded minutes.
        expect(formatTimeValue('9:5')).toBe('9:05 AM');
    });

    it('returns an empty string when the value cannot be shown as it is stored', () => {
        // The caller shows its placeholder rather than printing a corrupt time.
        for (const value of ['99:99', '24:00', 'not-a-time', ' 09:30', '09:30:00', '123:45']) {
            expect(formatTimeValue(value)).toBe('');
        }
    });

    it('round-trips through parseTimeValue without drifting', () => {
        for (let minute = 0; minute < 24 * 60; minute += 7) {
            const hour24 = Math.floor(minute / 60);
            const stored = `${String(hour24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
            const { h, m, period } = parseTimeValue(stored);
            const hours24 = (h % 12) + (period === 'PM' ? 12 : 0);
            expect(`${String(hours24).padStart(2, '0')}:${String(m).padStart(2, '0')}`).toBe(stored);
        }
    });
});
