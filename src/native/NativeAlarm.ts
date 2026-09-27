import { registerPlugin } from '@capacitor/core';
import type { NativeAlarmDefinition, NativeAlarmOptions } from '../types';
import { MAX_NATIVE_ALARM_HORIZON_MS, MAX_NATIVE_ALARM_ID, MIN_NATIVE_ALARM_ID } from './alarmLimits';

export {
    MAX_FOCUS_ALARMS,
    MAX_NATIVE_ALARM_BODY_LENGTH,
    MAX_NATIVE_ALARM_DEFINITIONS,
    MAX_NATIVE_ALARM_HORIZON_MS,
    MAX_NATIVE_ALARM_ID,
    MAX_NATIVE_ALARM_TITLE_LENGTH,
    MIN_NATIVE_ALARM_ID,
    sanitizeNativeAlarmText,
} from './alarmLimits';

export interface NativeAlarmPlugin {
    scheduleAlarm(options: NativeAlarmOptions): Promise<void>;
    cancelAlarm(options: { id: number }): Promise<void>;
    /**
     * Replaces the entire persisted alarm store: every id missing from `alarms` is
     * cancelled natively. The store is shared with the focus countdown timer, so this
     * must not be used to reconcile a single subsystem.
     */
    syncAlarms(options: { alarms: NativeAlarmDefinition[] }): Promise<void>;
    /** Re-arms the persisted store, e.g. after resume or a permission change. */
    reconcileAlarms(): Promise<void>;
}

export const isValidNativeAlarmId = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_NATIVE_ALARM_ID &&
    value <= MAX_NATIVE_ALARM_ID;

/**
 * Mirrors `NativeAlarmPlugin.isValidAlarmTime`, which requires a future alarm
 * that is no further out than the re-arm horizon.
 */
export const isValidNativeAlarmTimestamp = (value: unknown, now = Date.now()): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > now && value - now <= MAX_NATIVE_ALARM_HORIZON_MS;

/**
 * Mirrors `NativeAlarmPlugin.exactTimestamp`, the gate the bridge applies to the
 * raw `time` field *before* it looks at the clock.
 *
 * The native side reads the value through `BigDecimal.longValueExact()`, so a
 * fractional millisecond is rejected outright rather than truncated. This is a
 * weaker check than {@link isValidNativeAlarmTimestamp} on purpose: it answers
 * "could the bridge read this at all", not "is this armable right now", and
 * `isValidAlarmTime` is the second gate applied afterwards.
 */
export const isExactNativeAlarmTimestamp = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0;

export const isValidNativeAlarmOptions = (value: unknown): value is NativeAlarmOptions => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<NativeAlarmOptions>;
    // `1.5` and `'5'` were both accepted here while the bridge rejected them, so
    // a caller that trusted this validator still learned about the refusal from
    // the round trip it was supposed to have avoided.
    return isValidNativeAlarmId(candidate.id) && isExactNativeAlarmTimestamp(candidate.time);
};

/**
 * Explains, before the bridge call, why an alarm cannot be scheduled.
 *
 * `reservedIds` carries the ids owned by another subsystem (the countdown
 * timer holds `TIMER_NOTIFICATION_ID`). Overwriting one of them would silently
 * stop a running session, so it is reported as its own failure rather than left
 * to surface as a mystery alarm at the wrong time.
 *
 * Returns `null` when the options are acceptable.
 */
export const nativeAlarmRejectionReason = (
    options: Partial<NativeAlarmOptions> | null | undefined,
    reservedIds: readonly number[] = [],
    now = Date.now(),
): string | null => {
    if (typeof options !== 'object' || options === null) {
        return 'Alarm details are missing.';
    }
    if (!isValidNativeAlarmId(options.id)) {
        return 'The alarm could not be scheduled because its id is outside the 31-bit range Android allows.';
    }
    if (reservedIds.includes(options.id)) {
        return 'The alarm could not be scheduled because its id is reserved by another alarm source.';
    }
    if (!isExactNativeAlarmTimestamp(options.time)) {
        // Reported separately from a past time on purpose. The bridge rejects a
        // fractional or non-numeric stamp in `readTimestamp`, long before it ever
        // compares it to the clock, and "the time has already passed" sends the
        // user looking at their clock instead of at the value that was sent.
        return 'The alarm could not be scheduled because its time is not a whole number of milliseconds.';
    }
    if (options.time <= now) {
        return 'The alarm time has already passed; it was not scheduled.';
    }
    if (options.time - now > MAX_NATIVE_ALARM_HORIZON_MS) {
        return 'The alarm could not be scheduled because it is further ahead than Android re-arms alarms for.';
    }
    return null;
};

const NativeAlarm = registerPlugin<NativeAlarmPlugin>('NativeAlarm');

export default NativeAlarm;
