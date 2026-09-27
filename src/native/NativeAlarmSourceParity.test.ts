/// <reference types="node" />
// The app's `tsconfig` deliberately keeps the Node type packages out of the
// browser graph, and this is the one test that genuinely reads the filesystem.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    MAX_NATIVE_ALARM_BODY_LENGTH,
    MAX_NATIVE_ALARM_DEFINITIONS,
    MAX_NATIVE_ALARM_HORIZON_MS,
    MAX_NATIVE_ALARM_ID,
    MAX_NATIVE_ALARM_TITLE_LENGTH,
    MIN_NATIVE_ALARM_ID,
    sanitizeNativeAlarmText,
} from './alarmLimits';

/**
 * The TypeScript mirrors in `alarmLimits` are only useful while they still
 * describe the Java they claim to mirror. Nothing in the build enforces that -
 * the Android sources are not compiled with the web app - so a change to
 * `NativeAlarmPlugin.java` would silently leave the web layer validating against
 * limits the device no longer uses.
 *
 * These assertions read the Java source directly, so the guard fails here rather
 * than quietly becoming a copy of the Java that stops checking it.
 */
const pluginSource = readFileSync(
    resolve(process.cwd(), 'android/app/src/main/java/com/sumon/studytracker/alarm/NativeAlarmPlugin.java'),
    'utf8',
);

/** The source text assigned to a `static final` constant, verbatim. */
const javaConstantExpression = (name: string): string => {
    const match = new RegExp(`static\\s+final\\s+(?:int|long)\\s+${name}\\s*=\\s*([^;]+);`).exec(pluginSource);
    if (!match?.[1]) {
        throw new Error(`NativeAlarmPlugin.java no longer declares a numeric constant named ${name}`);
    }
    return match[1].trim();
};

/** The value of a `static final` constant that is a single hex or decimal literal. */
const javaConstantValue = (name: string): number => {
    const expression = javaConstantExpression(name);
    if (!/^0[xX][0-9a-fA-F]+[lL]?$/.test(expression) && !/^[0-9]+[lL]?$/.test(expression)) {
        throw new Error(`${name} is no longer a single literal (${expression}), so it cannot be mirrored verbatim`);
    }
    const literal = expression.replace(/[lL]$/, '');
    return literal.toLowerCase().startsWith('0x') ? Number.parseInt(literal.slice(2), 16) : Number(literal);
};

describe('NativeAlarm TypeScript/Java contract parity', () => {
    it('mirrors the id bounds the plugin enforces on the way in and out', () => {
        // `NativeAlarmPlugin.exactId` is the single id gate, used by
        // `scheduleAlarm`, `cancelAlarm`, the store and `AlarmReceiver`.
        expect(javaConstantValue('MAX_ALARM_ID')).toBe(0x7fffffff);
        expect(MIN_NATIVE_ALARM_ID).toBe(1);
        expect(MAX_NATIVE_ALARM_ID).toBe(javaConstantValue('MAX_ALARM_ID'));
        // The Java spells the lower bound as `id < 1` rather than as a constant,
        // so it is asserted here instead of being mirrored into a magic number.
        expect(pluginSource).toMatch(/value\s*<\s*1\s*\|\|\s*value\s*>\s*MAX_ALARM_ID/);
        expect(pluginSource).toMatch(/id\s*>\s*0\s*&&\s*id\s*<=\s*MAX_ALARM_ID/);
    });

    it('mirrors the re-arm horizon exactly, including its 400-day spelling', () => {
        // A drift here is invisible until an alarm is refused natively, so the
        // expression is compared as well as the number it evaluates to.
        expect(javaConstantExpression('MAX_ALARM_HORIZON_MILLIS')).toBe('400L * 24L * 60L * 60L * 1000L');
        expect(MAX_NATIVE_ALARM_HORIZON_MS).toBe(400 * 24 * 60 * 60 * 1000);
    });

    it('mirrors the shared store size', () => {
        expect(MAX_NATIVE_ALARM_DEFINITIONS).toBe(javaConstantValue('MAX_DEFINITIONS'));
    });

    it('mirrors the notification text bounds the plugin sanitises against', () => {
        expect(MAX_NATIVE_ALARM_TITLE_LENGTH).toBe(javaConstantValue('MAX_TITLE_LENGTH'));
        expect(MAX_NATIVE_ALARM_BODY_LENGTH).toBe(javaConstantValue('MAX_BODY_LENGTH'));
    });

    it('agrees with sanitizeText about a fallback, an empty value and truncation', () => {
        // `NativeAlarmPlugin.sanitizeText` treats null and empty as "use the
        // fallback", and cuts on Java `String.length` (UTF-16 code units), which
        // is what `String.prototype.slice` counts too.
        expect(pluginSource).toMatch(
            /String\s+resolved\s*=\s*value\s*==\s*null\s*\|\|\s*value\.isEmpty\(\)\s*\?\s*fallback\s*:\s*value;/,
        );
        expect(sanitizeNativeAlarmText(undefined, 'Alarm', 10)).toBe('Alarm');
        expect(sanitizeNativeAlarmText(null, 'Alarm', 10)).toBe('Alarm');
        expect(sanitizeNativeAlarmText('', 'Alarm', 10)).toBe('Alarm');
        expect(sanitizeNativeAlarmText('Focus Alarm', 'Alarm', 20)).toBe('Focus Alarm');
        expect(sanitizeNativeAlarmText('0123456789abc', 'Alarm', 10)).toBe('0123456789');
        // A non-string is not something the Java can even receive - the plugin
        // reads the field through `readString`, which falls back - so the mirror
        // resolves it to the fallback rather than stringifying it.
        expect(sanitizeNativeAlarmText(42, 'Alarm', 10)).toBe('Alarm');
        expect(sanitizeNativeAlarmText('anything', 'Alarm', 0)).toBe('');
    });

    it('keeps the store limit and the horizon in the shape the plugin validates them', () => {
        // `upsertDefinition` (single arm) and `parseDefinitions` (bulk sync) both
        // refuse to grow the store past MAX_DEFINITIONS, and only the single arm
        // path also requires a future time. The TypeScript cap is derived from
        // MAX_DEFINITIONS rather than restated, which is what keeps the focus
        // list from filling a store the plugin would refuse to append to.
        expect(pluginSource).toMatch(/definitions\.size\(\)\s*>=\s*MAX_DEFINITIONS/);
        expect(pluginSource).toMatch(/isValidAlarmTime\(now,\s*time\)/);
        expect(pluginSource).toMatch(/isWithinHorizon\(now,\s*time\)/);
    });
});
