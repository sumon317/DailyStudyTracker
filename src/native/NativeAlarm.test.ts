import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn((name: string) => ({ __plugin: name })),
}));

import NativeAlarm, {
    isExactNativeAlarmTimestamp,
    isValidNativeAlarmId,
    isValidNativeAlarmOptions,
    isValidNativeAlarmTimestamp,
    MAX_FOCUS_ALARMS,
    MAX_NATIVE_ALARM_DEFINITIONS,
    MAX_NATIVE_ALARM_HORIZON_MS,
    MAX_NATIVE_ALARM_ID,
    MIN_NATIVE_ALARM_ID,
    nativeAlarmRejectionReason,
} from './NativeAlarm';

const NOW = 1_800_000_000_000;

describe('NativeAlarm bridge contract', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('registers under the name the native plugin declares', () => {
        expect(NativeAlarm).toEqual({ __plugin: 'NativeAlarm' });
    });

    it('mirrors the native 31-bit id range', () => {
        expect(MIN_NATIVE_ALARM_ID).toBe(1);
        expect(MAX_NATIVE_ALARM_ID).toBe(0x7fffffff);
        expect(isValidNativeAlarmId(1)).toBe(true);
        expect(isValidNativeAlarmId(0x7fffffff)).toBe(true);
        expect(isValidNativeAlarmId(0)).toBe(false);
        expect(isValidNativeAlarmId(-1)).toBe(false);
        expect(isValidNativeAlarmId(0x80000000)).toBe(false);
        expect(isValidNativeAlarmId(1.5)).toBe(false);
        expect(isValidNativeAlarmId(Number.NaN)).toBe(false);
        expect(isValidNativeAlarmId('101')).toBe(false);
        expect(isValidNativeAlarmId(null)).toBe(false);
        expect(isValidNativeAlarmId(undefined)).toBe(false);
    });

    it('requires a future integer timestamp, as NativeAlarmPlugin.readTimestamp does', () => {
        expect(isValidNativeAlarmTimestamp(NOW + 1, NOW)).toBe(true);
        expect(isValidNativeAlarmTimestamp(NOW, NOW)).toBe(false);
        expect(isValidNativeAlarmTimestamp(NOW - 1, NOW)).toBe(false);
        expect(isValidNativeAlarmTimestamp(NOW + 0.5, NOW)).toBe(false);
        expect(isValidNativeAlarmTimestamp('later', NOW)).toBe(false);
    });

    it('mirrors the 400-day re-arm horizon the native plugin enforces', () => {
        // `NativeAlarmPlugin.isValidAlarmTime` refuses anything past
        // MAX_ALARM_HORIZON_MILLIS, after the call has already crossed the bridge.
        expect(MAX_NATIVE_ALARM_HORIZON_MS).toBe(400 * 24 * 60 * 60 * 1000);
        expect(isValidNativeAlarmTimestamp(NOW + MAX_NATIVE_ALARM_HORIZON_MS, NOW)).toBe(true);
        expect(isValidNativeAlarmTimestamp(NOW + MAX_NATIVE_ALARM_HORIZON_MS + 1, NOW)).toBe(false);
        expect(nativeAlarmRejectionReason({ id: 5, time: NOW + MAX_NATIVE_ALARM_HORIZON_MS + 1 }, [], NOW)).toMatch(
            /further ahead/i,
        );
        expect(nativeAlarmRejectionReason({ id: 5, time: NOW + MAX_NATIVE_ALARM_HORIZON_MS }, [], NOW)).toBeNull();
    });

    it('publishes the shared store limit the native plugin appends against', () => {
        // `NativeAlarmPlugin.MAX_DEFINITIONS`; the countdown timer holds one of
        // these slots, so the focus list has to leave room for it.
        expect(MAX_NATIVE_ALARM_DEFINITIONS).toBe(64);
        expect(MAX_FOCUS_ALARMS).toBe(MAX_NATIVE_ALARM_DEFINITIONS - 1);
        // Derived, never restated: a list that could be filled to the plugin's own
        // limit would let the last alarm be refused by `upsertDefinition` while
        // the UI still counted it as armed.
        expect(MAX_FOCUS_ALARMS).toBeLessThan(MAX_NATIVE_ALARM_DEFINITIONS);
    });

    it('reads a timestamp exactly as the bridge does before it looks at the clock', () => {
        // `NativeAlarmPlugin.exactTimestamp` goes through `longValueExact()`, so a
        // fractional millisecond is refused outright rather than truncated.
        expect(isExactNativeAlarmTimestamp(NOW + 1000)).toBe(true);
        expect(isExactNativeAlarmTimestamp(NOW + 0.5)).toBe(false);
        expect(isExactNativeAlarmTimestamp(0)).toBe(false);
        expect(isExactNativeAlarmTimestamp(-1)).toBe(false);
        expect(isExactNativeAlarmTimestamp(Number.NaN)).toBe(false);
        expect(isExactNativeAlarmTimestamp(`${NOW}`)).toBe(false);
        // Weaker than the armable check on purpose: this only answers "could the
        // bridge read this", so a past but well-formed stamp still passes it.
        expect(isExactNativeAlarmTimestamp(NOW - 1)).toBe(true);
        expect(isValidNativeAlarmTimestamp(NOW - 1, NOW)).toBe(false);
    });

    it('accepts an options object the native side can read', () => {
        expect(isValidNativeAlarmOptions({ id: 42, time: NOW + 1000 })).toBe(true);
        expect(isValidNativeAlarmOptions({ id: 42, time: NOW + 1000, title: 't', body: 'b' })).toBe(true);
        expect(isValidNativeAlarmOptions({ id: 42 })).toBe(false);
        expect(isValidNativeAlarmOptions({ time: NOW })).toBe(false);
        expect(isValidNativeAlarmOptions(null)).toBe(false);
        expect(isValidNativeAlarmOptions('alarm')).toBe(false);
        // A fractional or stringified stamp was accepted here while
        // `exactTimestamp` refused it, so the round trip this validator exists to
        // avoid was still happening for the values it claimed to have cleared.
        expect(isValidNativeAlarmOptions({ id: 42, time: NOW + 0.5 })).toBe(false);
        expect(isValidNativeAlarmOptions({ id: 42, time: `${NOW + 1000}` })).toBe(false);
        expect(isValidNativeAlarmOptions({ id: 42, time: Number.NaN })).toBe(false);
    });

    it('reports why an alarm cannot be scheduled instead of failing at the bridge', () => {
        expect(nativeAlarmRejectionReason({ id: 5, time: NOW + 1 }, [], NOW)).toBeNull();
        expect(nativeAlarmRejectionReason({ id: 0, time: NOW + 1 }, [], NOW)).toMatch(/31-bit/);
        expect(nativeAlarmRejectionReason({ id: 5, time: NOW }, [], NOW)).toMatch(/already passed/);
        expect(nativeAlarmRejectionReason(undefined, [], NOW)).toMatch(/missing/);
    });

    it('does not blame the clock for a timestamp the bridge could not read', () => {
        // "already passed" sends the user to look at their clock, which is the
        // wrong place: the value that was sent is the thing that is wrong.
        expect(nativeAlarmRejectionReason({ id: 5, time: NOW + 0.5 }, [], NOW)).toMatch(/whole number of milliseconds/);
        expect(nativeAlarmRejectionReason({ id: 5 }, [], NOW)).toMatch(/whole number of milliseconds/);
        expect(nativeAlarmRejectionReason({ id: 5, time: 'later' as unknown as number }, [], NOW)).toMatch(
            /whole number of milliseconds/,
        );
        // A well-formed but expired stamp is still a clock problem.
        expect(nativeAlarmRejectionReason({ id: 5, time: NOW - 1 }, [], NOW)).toMatch(/already passed/);
    });

    it('refuses to take an id that another alarm source owns', () => {
        // The countdown timer holds TIMER_NOTIFICATION_ID; overwriting it would
        // silently stop a running session.
        const reason = nativeAlarmRejectionReason({ id: 101, time: NOW + 1 }, [101], NOW);
        expect(reason).toMatch(/reserved/);
        expect(nativeAlarmRejectionReason({ id: 101, time: NOW + 1 }, [], NOW)).toBeNull();
    });
});
