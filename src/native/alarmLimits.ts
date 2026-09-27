/**
 * The native alarm store's limits, mirrored from
 * `NativeAlarmPlugin.java` so the TypeScript side can refuse an alarm before the
 * bridge round trip that would discover the refusal.
 *
 * These live in their own module because three unrelated layers have to agree on
 * them: the focus alarm component (how many the user may create), the storage
 * validator (how many a restore may contain) and the plugin (how many the shared
 * persisted store holds). Importing them from `NativeAlarm.ts` would drag
 * `registerPlugin` into the storage layer's module graph, which is a side effect
 * a data validator has no business triggering.
 */

/** Mirrors `NativeAlarmPlugin.MIN_ALARM_ID`. */
export const MIN_NATIVE_ALARM_ID = 1;

/**
 * Mirrors `NativeAlarmPlugin.MAX_ALARM_ID`: `PendingIntent` request codes are
 * truncated to 31 bits and the plugin rejects anything above this.
 */
export const MAX_NATIVE_ALARM_ID = 0x7fffffff;

/**
 * Mirrors `NativeAlarmPlugin.MAX_ALARM_HORIZON_MILLIS` (400 days).
 *
 * Alarms are re-armed on every boot, package replace and foreground pass, so a
 * timestamp further out than this is always a bug rather than a long-lived
 * schedule.
 */
export const MAX_NATIVE_ALARM_HORIZON_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * Mirrors `NativeAlarmPlugin.MAX_DEFINITIONS`: the shared persisted store holds
 * at most this many definitions, and `scheduleAlarm` refuses to append past it.
 */
export const MAX_NATIVE_ALARM_DEFINITIONS = 64;

/** Mirrors `NativeAlarmPlugin.MAX_TITLE_LENGTH`. */
export const MAX_NATIVE_ALARM_TITLE_LENGTH = 200;

/** Mirrors `NativeAlarmPlugin.MAX_BODY_LENGTH`. */
export const MAX_NATIVE_ALARM_BODY_LENGTH = 512;

/**
 * Mirrors `NativeAlarmPlugin.sanitizeText`.
 *
 * The title and body are copied into a `PendingIntent` the system server holds
 * on the app's behalf, so an unbounded string from the bridge is a binder-size
 * hazard as well as a layout hazard. Sanitising on this side as well means a
 * caller can see the text the device will actually show instead of only finding
 * out that the bridge quietly truncated it.
 */
export const sanitizeNativeAlarmText = (value: unknown, fallback: string, maxLength: number): string => {
    const resolved = typeof value === 'string' && value.length > 0 ? value : fallback;
    if (maxLength <= 0) {
        return '';
    }
    return resolved.length <= maxLength ? resolved : resolved.slice(0, maxLength);
};

/**
 * How many focus alarms the list may hold.
 *
 * The store is shared with the countdown timer, so the list has to leave room
 * for `TIMER_NOTIFICATION_ID`. The timer no longer *arms* a `NativeAlarm`
 * definition - its authoritative alert is a `LocalNotifications` one, and it
 * only ever cancels this id - but a build from before that change can have left
 * an entry behind, and `upsertDefinition` refuses to append past
 * `MAX_NATIVE_ALARM_DEFINITIONS`. Reserving the slot costs the user one alarm
 * and makes that legacy entry impossible to overflow. Deriving the cap here is
 * what keeps the component, the storage validator and the plugin from drifting
 * apart: a list that could be filled to the plugin's own limit would let the
 * last alarm be rejected natively while the UI still counted it as armed.
 */
export const MAX_FOCUS_ALARMS = MAX_NATIVE_ALARM_DEFINITIONS - 1;
