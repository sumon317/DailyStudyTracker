import type { PluginListenerHandle } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';
import type { LocalNotificationSchema, Schedule, ScheduleResult } from '@capacitor/local-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { NotificationScheduleResult } from '../types';
import type { AlarmAudioController } from './alarmAudio';
import { createAlarmAudio } from './alarmAudio';

export type NotificationEntityType = 'subject' | 'todo' | 'timer' | 'focus-alarm';

/**
 * The single source of truth for the entity types. Metadata read back off a
 * pending notification is matched against this list, so a type added to the
 * union without adding it here would make the service silently drop every alarm
 * it had just armed.
 */
const NOTIFICATION_ENTITY_TYPES: readonly NotificationEntityType[] = ['subject', 'todo', 'timer', 'focus-alarm'];

export interface NotificationLifecycleMetadata {
    type: NotificationEntityType;
    entityId: string | number;
    date: string;
    originalId: string | number;
}

/**
 * The entity a notification belongs to, as its own `extra` metadata reports it.
 * `null` when the metadata is missing or names a type this build does not know,
 * which is the honest answer: the shell must not act on an entity it cannot
 * identify.
 */
export interface NotificationActionData {
    originalId: string | number;
    actionId: string;
    actionType: string;
    type: NotificationEntityType | null;
    entityId: string | number | undefined;
}

export interface NotificationReceiveData {
    originalId: string | number;
    actionType: string | undefined;
    type: NotificationEntityType | null;
    entityId: string | number | undefined;
}

export interface SessionNotificationScheduleResult extends NotificationScheduleResult {
    sessionOnly?: boolean;
    reliableOnlyWhileOpen?: boolean;
    /**
     * Capacitor registered the alarm but downgraded it to an inexact one, so it may
     * arrive late instead of at the requested minute. `warning` carries the plugin's
     * own `ScheduleResult.warning` text, which is the only place the downgrade is
     * ever reported - the plugin resolves such a call successfully.
     */
    inexact?: boolean;
    warning?: string;
    /**
     * The pass armed and cancelled nothing, on purpose, so at least one alarm
     * family it was asked about is *not* reconciled by this result.
     *
     * `success` alone cannot say that: a deliberate no-op and a completed
     * reconcile are both `{ success: true }`, so a caller that only reads
     * `success` cannot tell "everything you asked for is armed" from "I
     * deliberately touched nothing and the alarms you are relying on are still
     * whatever they were". This flag carries that second meaning, and it
     * survives the aggregation of the subject and todo passes, where a skipped
     * half would otherwise be flattened into a plain success.
     */
    skipped?: boolean;
}

export interface SubjectNotificationDefinition {
    id: string | number;
    title: string;
    body: string;
    date: Date | string;
    actionType?: string;
}

export interface TodoNotificationDefinition {
    id: string | number;
    title: string;
    body: string;
    hour: number;
    minute: number;
    actionType?: string;
}

/**
 * The one channel every alarm in this app is posted to, and the one place its
 * loudness is configured. `initialize` creates exactly this channel and every
 * scheduled notification names it, so a reminder and a running countdown
 * cannot end up on two channels with two different sounds - which is what used
 * to make one focus session ring twice.
 *
 * Changing this id mints a *new* channel: the old one is left behind on the
 * device with its own settings, so a bump has to be a deliberate act.
 */
export const NOTIFICATION_CHANNEL_ID = 'study-alarms-v4';
export const NOTIFICATION_ICON = 'ic_timer_icon';
/**
 * A *native* sound name, the single source of truth for the tone an alarm
 * makes. Android resolves it from the `NOTIFICATION_CHANNEL_ID` channel above;
 * every other platform resolves it off the notification itself, because the
 * plugin documents that a notification carrying no `sound` is *silent on iOS*.
 *
 * This is not the `/alarm_loop.mp3` web URL used by `alarmAudio.ts` - the two
 * files are separate encodes that merely share a name.
 */
export const NOTIFICATION_SOUND = 'alarm_loop.mp3';
export const NOTIFICATION_VISIBILITY = 0 as const;
export const TIMER_NOTIFICATION_ID = 101;

const NOTIFICATION_ID_MAX = 0x7fffffff;

/** `setTimeout` delays are stored as a signed 32-bit int, so a longer wait has to be split. */
const MAX_TIMEOUT_MS = 2_147_000_000;

const PERMISSION_DENIED_ERROR = 'Notification permission not granted';
const PERMISSION_UNREADABLE_ERROR = 'Unable to read the notification permission on this device';
const EXACT_ALARM_DENIED_ERROR = 'Exact alarm permission not granted';
const EXACT_ALARM_UNREADABLE_ERROR = 'Unable to read the exact alarm setting on this device';
const PAST_DATE_ERROR = 'Notification time must be in the future';
const INVALID_DATE_ERROR = 'Invalid notification date';
const PENDING_UNREADABLE_ERROR = 'Unable to read the scheduled notifications on this device';
const CANCEL_FAILED_ERROR = 'Unable to cancel the notification on this device';
const INIT_FAILED_ERROR = 'Unable to prepare notifications on this device';
const ACTION_TYPES_FAILED_ERROR = 'Unable to register the notification actions on this device';
const NOT_REGISTERED_ERROR = 'The device accepted the alarm without arming it';
const WEB_UNSUPPORTED_ERROR = 'Web Notifications are only available in a supported browser';
/**
 * A refusal the user actually made.
 */
const WEB_PERMISSION_DENIED_ERROR = 'Notification permission denied';
/**
 * Not a refusal: the browser still reports `default`, which means nobody has
 * been asked. Calling that "denied" blames the user for a choice they were
 * never offered, and it is the state a reconcile that must not prompt lands in.
 */
const WEB_PERMISSION_UNANSWERED_ERROR = 'Notification permission has not been granted yet';

const localDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const dateFromKey = (value: string): Date => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        return new Date(Number.NaN);
    }
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
};

/**
 * The instant a caller asked for, or `null` when it is not one.
 *
 * Every entry point goes through here instead of trusting the declared `Date`
 * type: `at.getTime()` on a non-Date throws, and a `schedule` that rejects
 * because of a caller's bad argument is reported by the shell as an
 * unexplained "unable to schedule" rather than as the bad date it is.
 */
const toInstant = (value: Date | number | string | null | undefined): Date | null => {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value !== 'number' && typeof value !== 'string') {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const metadataFor = (
    type: NotificationEntityType,
    entityId: string | number,
    date: Date,
): NotificationLifecycleMetadata => ({
    type,
    entityId,
    date: localDateKey(date),
    originalId: entityId,
});

const errorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return 'Unknown notification error';
    }
};

const isAndroid = (): boolean => {
    if (!Capacitor.isNativePlatform()) {
        return false;
    }
    const getPlatform = (Capacitor as unknown as { getPlatform?: () => string }).getPlatform;
    return getPlatform ? getPlatform() === 'android' : true;
};

/**
 * A permission read that failed is not a denial, and the two are reported
 * separately: a bridge error must never be shown to the user as "you denied
 * this", and it must never be treated as consent either.
 */
type PermissionState = 'granted' | 'denied' | 'unreadable';

const readNotificationPermission = async (): Promise<PermissionState> => {
    try {
        const result = await LocalNotifications.checkPermissions();
        return result.display === 'granted' ? 'granted' : 'denied';
    } catch {
        return 'unreadable';
    }
};

const readExactNotificationPermission = async (): Promise<PermissionState> => {
    const state = await readExactAlarmState();
    // A platform that does not ask the question is treated as granted here; the
    // schedule path has no channel to sound through, so the distinction is
    // carried by the public tri-state accessor instead.
    return state === 'not-applicable' ? 'granted' : state;
};

/**
 * The four answers to "will this device honour an exact alarm".
 *
 * `not-applicable` is deliberately not `granted`: off Android nobody made a
 * grant, the platform simply does not ask. Collapsing the two into one boolean
 * is what made a bridge failure - `unreadable` - indistinguishable from a
 * refusal, and the shell answers a refusal by telling the user to go and grant
 * a permission they either hold or cannot act on.
 */
export type ExactAlarmState = 'granted' | 'denied' | 'unreadable' | 'not-applicable';

const readExactAlarmState = async (): Promise<ExactAlarmState> => {
    // `checkExactNotificationSetting` is Android-only and throws
    // `unimplemented` on every other platform, where "exact" is not a choice.
    if (!Capacitor.isNativePlatform() || !isAndroid()) {
        return 'not-applicable';
    }
    try {
        const result = await LocalNotifications.checkExactNotificationSetting();
        return result.exact_alarm === 'granted' ? 'granted' : 'denied';
    } catch {
        return 'unreadable';
    }
};

const requestDisplayPermission = async (): Promise<boolean> => (await requestDisplayPermissionState()) === 'granted';

const requestDisplayPermissionState = async (): Promise<PermissionState> => {
    try {
        const result = await LocalNotifications.requestPermissions();
        return result.display === 'granted' ? 'granted' : 'denied';
    } catch {
        return 'unreadable';
    }
};

/**
 * The display permission as a single boolean, collapsing the three states a read
 * can produce. `unreadable` is folded into `false` on purpose: this is the
 * yes/no a caller shows to the user, and a bridge failure is never consent.
 */
const getNotificationPermission = async (): Promise<boolean> => (await readNotificationPermission()) === 'granted';

/**
 * Whether the device will honour an exact alarm.
 *
 * `true` off Android means "not a question this platform asks" rather than a
 * grant the user made: `checkExactNotificationSetting` throws `unimplemented`
 * on iOS and does not exist in a browser. Reporting `false` there would show
 * the exact-alarm prompt to users who cannot act on it, and would block
 * scheduling a notification the platform delivers on time anyway.
 *
 * The one thing this boolean cannot express is a *failed read*, which folds
 * into `false` alongside a real denial. A shell that shows a grant prompt off
 * this answer will show it after a bridge failure too; use
 * `getExactAlarmState` where that difference is actionable.
 */
const getExactNotificationPermission = async (): Promise<boolean> => {
    const state = await readExactAlarmState();
    return state === 'granted' || state === 'not-applicable';
};

/**
 * The browser notification constructor, or `null` where there is not one.
 *
 * `'Notification' in window` is not enough: a stubbed, blocked or partially
 * initialised `Notification` still satisfies the `in` check and then throws on
 * first use, which would surface as a schedule that failed for no stated reason.
 */
const webNotificationApi = (): typeof Notification | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    const api = (window as unknown as { Notification?: unknown }).Notification;
    return typeof api === 'function' ? (api as typeof Notification) : null;
};

const getWebPermission = (): NotificationPermission | null => webNotificationApi()?.permission ?? null;

const requestWebPermission = async (): Promise<boolean> => {
    const api = webNotificationApi();
    if (!api) {
        return false;
    }
    try {
        return (await api.requestPermission()) === 'granted';
    } catch {
        return false;
    }
};

interface WebReminder {
    key: string;
    type: NotificationEntityType;
    entityId: string | number;
    timeoutId: number;
    notification: Notification | null;
    /**
     * The tone for the occurrence that has just fired.
     *
     * Replaced (and the previous one disposed) on every firing, so a repeating
     * reminder does not build up one live audio graph per day, and released by
     * `clearWebReminder` so a cancelled reminder stops sounding at once.
     */
    audio: AlarmAudioController | null;
    cancelled: boolean;
}

const webReminders = new Map<string, WebReminder>();
const notificationListenerHandles: PluginListenerHandle[] = [];
let notificationListenerGeneration = 0;

const webReminderKey = (type: NotificationEntityType, entityId: string | number): string =>
    `${type}:${String(entityId)}`;

const clearWebReminder = (key: string): void => {
    const entry = webReminders.get(key);
    if (!entry) {
        return;
    }
    entry.cancelled = true;
    if (typeof window !== 'undefined') {
        window.clearTimeout(entry.timeoutId);
    }
    entry.notification?.close();
    // The tone is stopped and its graph torn down, not just paused: a cancelled or
    // superseded reminder must not keep a looping tone (and a `MediaElementSource`
    // for a ~1.4 MiB asset) alive.
    entry.audio?.dispose();
    entry.audio = null;
    webReminders.delete(key);
};

const clearWebReminders = (type?: NotificationEntityType, entityId?: string | number): void => {
    for (const [key, entry] of webReminders) {
        if (type !== undefined && entry.type !== type) {
            continue;
        }
        if (entityId !== undefined && String(entry.entityId) !== String(entityId)) {
            continue;
        }
        clearWebReminder(key);
    }
};

/**
 * Drops the reminders of `type` that the caller is not about to re-arm.
 *
 * The leftovers are swept *after* the desired set is armed rather than before,
 * so a re-arm that fails (a revoked permission, an impossible date) leaves the
 * reminder that was already working in place. Clearing first and arming second
 * - the order the native path effectively gets for free, because
 * `reconcilePending` only cancels ids the desired set does not contain - would
 * turn one bad entry into a reminder the user silently lost.
 */
const clearStaleWebReminders = (type: NotificationEntityType, keep: ReadonlySet<string>): void => {
    for (const [key, entry] of webReminders) {
        if (entry.type === type && !keep.has(key)) {
            clearWebReminder(key);
        }
    }
};

const nativeIdsFor = (type: NotificationEntityType, entityId: string | number): number[] => {
    if (type === 'timer') {
        return [TIMER_NOTIFICATION_ID];
    }
    return [getNotificationId(type, entityId)];
};

const aggregateResults = (results: SessionNotificationScheduleResult[]): SessionNotificationScheduleResult => {
    const failed = results.find((result) => !result.success);
    if (failed) {
        return failed;
    }
    // A downgrade is not a failure, but it must survive the aggregation instead of
    // being flattened into a bare success.
    const inexact = results.find((result) => result.inexact);
    // A half of the pass that deliberately did nothing is not a success for the
    // other half either, so the flag rides along instead of being dropped here.
    const skipped = results.some((result) => result.skipped);
    if (skipped) {
        return inexact
            ? { success: true, inexact: true, warning: inexact.warning, skipped: true }
            : { success: true, skipped: true };
    }
    return inexact ? { success: true, inexact: true, warning: inexact.warning } : { success: true };
};

export const safeId = (id: string | number): number => {
    const value = String(id);
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(index);
        // Keep the accumulator inside int32: `<<` wraps, but the additions around
        // it do not, so without this the running value escapes the range the hash
        // is defined over and the ids stop being reproducible across engines.
        hash |= 0;
    }
    const result = (Math.abs(hash) ^ 0x5f3759df) & NOTIFICATION_ID_MAX;
    return result === 0 ? 1 : result;
};

const RESERVED_NOTIFICATION_IDS: ReadonlySet<number> = new Set([TIMER_NOTIFICATION_ID]);

export const getNotificationId = (type: NotificationEntityType, entityId: string | number): number => {
    const id = safeId(`${type}:${String(entityId)}`);
    if (!RESERVED_NOTIFICATION_IDS.has(id)) {
        return id;
    }
    return id >= NOTIFICATION_ID_MAX ? 1 : id + 1;
};

export const NOTIFICATION_IDS = Object.freeze({
    subject: (entityId: string | number): number => getNotificationId('subject', entityId),
    todo: (entityId: string | number): number => getNotificationId('todo', entityId),
    timer: TIMER_NOTIFICATION_ID,
    focusAlarm: (entityId: string | number): number => getNotificationId('focus-alarm', entityId),
});

export const getSubjectNotificationId = (entityId: string | number): number => NOTIFICATION_IDS.subject(entityId);
export const getTodoNotificationId = (entityId: string | number): number => NOTIFICATION_IDS.todo(entityId);
export const getFocusAlarmId = (entityId: string | number): number => NOTIFICATION_IDS.focusAlarm(entityId);

export const getNextDailyReminderDate = (hour: number, minute: number, now = new Date()): Date => {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        throw new RangeError('Hour must be an integer from 0 to 23');
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
        throw new RangeError('Minute must be an integer from 0 to 59');
    }

    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
    }
    return target;
};

export const calculateNextDailyReminderDate = getNextDailyReminderDate;
export const getDailyReminderDate = getNextDailyReminderDate;

export const parseReminderTime = (value: string): { hour: number; minute: number } | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) {
        return null;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        return null;
    }
    return { hour, minute };
};

const scheduleWebReminder = async (
    type: NotificationEntityType,
    entityId: string | number,
    title: string,
    body: string,
    target: Date,
    repeats: boolean,
    actionType: string,
    requestPermission: boolean,
): Promise<SessionNotificationScheduleResult> => {
    if (!webNotificationApi()) {
        return { success: false, error: WEB_UNSUPPORTED_ERROR };
    }

    // A one-shot whose moment has passed is refused, exactly as the native path
    // refuses it. `setTimeout` clamps a negative delay to zero, so scheduling it
    // anyway would fire the reminder immediately and report success - the worst
    // possible outcome, because the user is told a reminder is set and it has
    // already been shown. Checked before the permission work so a bad date
    // neither prompts nor disturbs an already-armed reminder for this entity.
    // A repeating reminder is exempt: its target is a future occurrence by
    // construction, and the reschedule loop is what keeps the series alive.
    if (!repeats && target.getTime() <= Date.now()) {
        return { success: false, error: PAST_DATE_ERROR };
    }

    let permission = getWebPermission();
    if (permission !== 'granted') {
        if (permission === 'denied') {
            return { success: false, error: WEB_PERMISSION_DENIED_ERROR };
        }
        // `default` means nobody has been asked. That is the state a reconcile
        // lands in, because it must never open a permission dialog on its own,
        // and it is reported as its own thing rather than as a denial the user
        // never chose.
        if (!requestPermission) {
            return { success: false, error: WEB_PERMISSION_UNANSWERED_ERROR };
        }
        if (!(await requestWebPermission())) {
            return { success: false, error: WEB_PERMISSION_DENIED_ERROR };
        }
        permission = 'granted';
    }

    const key = webReminderKey(type, entityId);
    clearWebReminder(key);
    const entry: WebReminder = {
        key,
        type,
        entityId,
        timeoutId: 0,
        notification: null,
        audio: null,
        cancelled: false,
    };
    webReminders.set(key, entry);

    const scheduleNext = (nextTarget: Date): void => {
        const dueAt = nextTarget.getTime();
        // A target further out than one timer tick wakes this up early; the
        // callback re-checks the clock instead of firing, so a far-future reminder
        // is never delivered ahead of its time.
        const delay = Math.min(Math.max(dueAt - Date.now(), 0), MAX_TIMEOUT_MS);
        entry.timeoutId = window.setTimeout(() => {
            if (entry.cancelled || webReminders.get(key) !== entry) {
                return;
            }
            entry.timeoutId = 0;
            const now = Date.now();
            if (dueAt > now) {
                scheduleNext(nextTarget);
                return;
            }
            try {
                // The browser replaces a notification carrying the same `tag`, so
                // the previous occurrence is already superseded on screen.
                // Closing its handle releases the object this entry would
                // otherwise keep alive for the life of the series, so a daily
                // reminder does not accumulate one live object per day.
                entry.notification?.close();
                const notification = new Notification(title, {
                    body,
                    icon: '/assets/pwa-192x192.png',
                    badge: '/assets/pwa-192x192.png',
                    tag: key,
                });
                /**
                 * Without this a web reminder was inert: the banner appeared and
                 * clicking it did nothing at all, not even raising the tab. The
                 * contract stays "reliable only while the app is open" - that is
                 * what a `setTimeout` can promise - but a notification that *is*
                 * delivered can at least bring the page it came from forward.
                 */
                notification.onclick = () => {
                    try {
                        globalThis.focus?.();
                    } catch {
                        // Some browsers only allow `focus()` from a user gesture
                        // and throw instead of returning false.
                    }
                    notification.close();
                };
                entry.notification = notification;
                /**
                 * The alarm tone, so a web reminder is an alarm and not a silent
                 * line of text. `createAlarmAudio` is the same source `App` and
                 * `CountdownTimer` use, so there is one gain value and one
                 * cross-origin handling for the whole app.
                 *
                 * A dedicated controller per reminder, not the app-level one: each
                 * reminder has to be able to stop on its own, and the app-level
                 * overlay is the shell's own thing (see `src/app/App.tsx`). On
                 * Android this path never runs - `scheduleWebNotification` is
                 * reached only when `Capacitor.isNativePlatform()` is false - so
                 * the two can never sound at once, and the app-level overlay still
                 * silences the countdown timer through `isForeignAlarmActive`.
                 */
                const audio = createAlarmAudio();
                entry.audio?.dispose();
                entry.audio = audio;
                void audio.play();
            } catch {
                entry.notification = null;
            }
            if (repeats) {
                const next = new Date(nextTarget);
                // Step the wall clock rather than adding 24h, so the reminder keeps
                // its time across a DST change, and skip any occurrence a suspended
                // tab slept through instead of firing the whole backlog at once.
                do {
                    next.setDate(next.getDate() + 1);
                } while (next.getTime() <= now);
                scheduleNext(next);
            }
        }, delay);
    };

    scheduleNext(target);
    // A web notification carries no action buttons, so `actionType` has no
    // counterpart here; the native path is the only one that registers them.
    void actionType;
    return {
        success: true,
        sessionOnly: true,
        reliableOnlyWhileOpen: true,
    };
};

const pendingTypeOf = (extra: Record<string, unknown> | undefined): NotificationEntityType | null => {
    const type = extra?.type;
    return typeof type === 'string' && NOTIFICATION_ENTITY_TYPES.includes(type as NotificationEntityType)
        ? (type as NotificationEntityType)
        : null;
};

const getPendingMetadata = (extra: Record<string, unknown> | undefined): NotificationLifecycleMetadata | null => {
    const type = pendingTypeOf(extra);
    if (!extra || !type) {
        return null;
    }
    const entityId = extra.entityId ?? extra.originalId;
    const date = typeof extra.date === 'string' ? extra.date : '';
    const validEntityId = typeof entityId === 'string' || (typeof entityId === 'number' && Number.isFinite(entityId));
    if (!validEntityId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return null;
    }
    return {
        type,
        entityId,
        date,
        originalId:
            typeof extra.originalId === 'number' || typeof extra.originalId === 'string' ? extra.originalId : entityId,
    };
};

/**
 * What a received or acted-upon notification identifies.
 *
 * `metadata` is the fully parsed record, and is `null` whenever any part of it
 * is missing or names a type this build does not know - the honest answer,
 * because a listener must not act on an entity it cannot identify.
 *
 * `entityId` is the one piece of that which is safe to use on its own, and it
 * is resolved from whichever field carries it. The two listeners used to read
 * `extra.originalId` directly and ignore the metadata entirely, so a record
 * that names its entity but leaves the round-tripped alias absent was reported
 * with the *notification* id instead. The shell compares that id against an
 * entity id, fails to match, and silently does nothing - while the notification
 * still looks like a tap that was handled.
 */
interface ResolvedNotificationEntity {
    metadata: NotificationLifecycleMetadata | null;
    entityId: string | number | undefined;
}

/** Only a real id counts. A `null`/`NaN` slip-through would be hashed into a notification id. */
const rawEntityIdOf = (extra: Record<string, unknown> | undefined): string | number | undefined => {
    for (const candidate of [extra?.originalId, extra?.entityId]) {
        if (typeof candidate === 'string') {
            return candidate;
        }
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            return candidate;
        }
    }
    return undefined;
};

const resolveNotificationEntity = (extra: Record<string, unknown> | undefined): ResolvedNotificationEntity => {
    const metadata = getPendingMetadata(extra);
    // The parsed metadata is preferred; the raw field is the fallback for a
    // record that names a real entity but is otherwise too malformed to parse,
    // where dropping the id would be strictly less useful than reporting it.
    return { metadata, entityId: metadata?.entityId ?? rawEntityIdOf(extra) };
};

const queryPendingNotifications = async (): Promise<LocalNotification[] | null> => {
    try {
        const result = await LocalNotifications.getPending();
        if (!result || !Array.isArray(result.notifications)) {
            return null;
        }
        return result.notifications.map((notification) => ({
            id: notification.id,
            title: notification.title,
            body: notification.body,
            extra: notification.extra as Record<string, unknown> | undefined,
            // Android deliberately keeps the stored record of an alarm that has
            // already fired so it stays queryable through `getByIds`/`getAll`,
            // and `getPending` does not filter those out. The schedule is passed
            // through so a caller can tell an armed alarm from a delivered one
            // instead of taking every record for a still-pending reminder.
            schedule: notification.schedule,
        }));
    } catch {
        return null;
    }
};

const removeDeliveredNativeIds = async (ids: number[]): Promise<void> => {
    const removeById = (
        LocalNotifications as unknown as {
            removeDeliveredNotificationsById?: (options: { ids: number[] }) => Promise<void>;
        }
    ).removeDeliveredNotificationsById;
    if (typeof removeById !== 'function' || ids.length === 0) {
        return;
    }
    try {
        await removeById({ ids });
    } catch {
        return;
    }
};

const removeAllDeliveredNative = async (): Promise<boolean> => {
    const removeAll = (
        LocalNotifications as unknown as {
            removeAllDeliveredNotifications?: () => Promise<void>;
        }
    ).removeAllDeliveredNotifications;
    if (typeof removeAll !== 'function') {
        return true;
    }
    try {
        await removeAll();
        return true;
    } catch {
        return false;
    }
};

const cancelNativeIds = async (ids: number[]): Promise<boolean> => {
    if (!Capacitor.isNativePlatform()) {
        return true;
    }
    const requested = [...new Set(ids)];
    if (requested.length === 0) {
        return true;
    }
    const uniqueIds = requested.filter((id) => Number.isInteger(id) && id > 0 && id <= NOTIFICATION_ID_MAX);
    if (uniqueIds.length === 0) {
        // Every id was outside the range Android accepts, so nothing was cancelled.
        return false;
    }
    let cancelled = true;
    try {
        await LocalNotifications.cancel({ notifications: uniqueIds.map((id) => ({ id })) });
    } catch {
        cancelled = false;
    }
    // `cancel` only drops the schedule; a notification that already fired stays on
    // the shade until it is removed by id, so the delivered copy is cleared too.
    await removeDeliveredNativeIds(uniqueIds);
    return cancelled;
};

/**
 * Drops the schedules of `type` whose entity is no longer desired.
 *
 * A record of this type whose metadata no longer parses is dropped as well: it
 * cannot be matched against the desired set, and the caller re-arms every
 * definition it was meant to cover right afterwards, so keeping it would strand
 * an alarm the user has no way to see or cancel.
 */
const reconcilePending = async (
    type: NotificationEntityType,
    desiredIds: Set<string>,
): Promise<SessionNotificationScheduleResult> => {
    if (!Capacitor.isNativePlatform()) {
        return { success: true };
    }
    const pending = await queryPendingNotifications();
    if (pending === null) {
        return { success: false, error: PENDING_UNREADABLE_ERROR };
    }
    const staleIds = pending
        .filter((notification) => {
            if (pendingTypeOf(notification.extra) !== type) {
                return false;
            }
            const metadata = getPendingMetadata(notification.extra);
            return !metadata || !desiredIds.has(String(metadata.entityId));
        })
        .map((notification) => notification.id);
    if (staleIds.length === 0) {
        return { success: true };
    }
    return (await cancelNativeIds(staleIds)) ? { success: true } : { success: false, error: CANCEL_FAILED_ERROR };
};

interface NativeScheduleRequest {
    type: NotificationEntityType;
    entityId: string | number;
    title: string;
    body: string;
    actionType: string;
    /** The instant this alarm is due. Always the next occurrence, never a series. */
    at: Date;
}

/**
 * Schedules one exact, non-repeating alarm.
 *
 * `repeats: true` is never used, because Capacitor 8 does not implement a daily
 * series through it: Android registers `setRepeating(at, at - now)` - the gap
 * until the first occurrence, which is not a day - and iOS builds a
 * `UNTimeIntervalNotificationTrigger` over the same gap. `schedule.on` is no
 * better: `DateMatch.postponeTriggerIfNeeded` rolls a past `{ hour, minute }`
 * match forward by an *hour*, so the series drifts to `HH:MM` in every hour, and
 * it repeats that mistake on every self-reschedule. A daily reminder is therefore
 * armed as a single exact alarm for its next occurrence and re-armed by the
 * reconcile pass, the same model the focus alarms use through `NativeAlarm`.
 */
const scheduleNativeNotification = async (
    request: NativeScheduleRequest,
): Promise<SessionNotificationScheduleResult> => {
    const { type, entityId, title, body, actionType } = request;
    try {
        const at = toInstant(request.at);
        if (!at) {
            return { success: false, error: INVALID_DATE_ERROR };
        }
        if (at.getTime() <= Date.now()) {
            return { success: false, error: PAST_DATE_ERROR };
        }
        const displayPermission = await readNotificationPermission();
        if (displayPermission !== 'granted') {
            // An unreadable state is retried as a request rather than reported as a
            // refusal: a bridge failure is not a decision the user made.
            const requested = await requestDisplayPermissionState();
            if (requested === 'unreadable') {
                return { success: false, error: PERMISSION_UNREADABLE_ERROR };
            }
            if (requested !== 'granted') {
                return { success: false, error: PERMISSION_DENIED_ERROR };
            }
        }
        const exactAlarm = await readExactNotificationPermission();
        if (exactAlarm === 'denied') {
            return { success: false, error: EXACT_ALARM_DENIED_ERROR };
        }
        if (exactAlarm === 'unreadable') {
            // The setting could not be read, so it is neither known to be
            // granted nor known to be denied. It is reported as unreadable
            // rather than scheduled optimistically: the UI turns this into an
            // explicit "could not tell" instead of showing a green success for an
            // alarm whose delivery is unknown, and the app re-checks on its next
            // resume (the plugin also drops pending exact alarms when the grant
            // is revoked, so a stale success would be wrong on its own).
            return { success: false, error: EXACT_ALARM_UNREADABLE_ERROR };
        }
        const id = type === 'timer' ? TIMER_NOTIFICATION_ID : getNotificationId(type, entityId);
        const schedule: Schedule = { at, repeats: false, allowWhileIdle: true };
        const notification: LocalNotificationSchema = {
            title,
            body,
            id,
            schedule,
            smallIcon: NOTIFICATION_ICON,
            channelId: NOTIFICATION_CHANNEL_ID,
            // One sound name, applied wherever the platform actually reads it.
            // Android takes it from `NOTIFICATION_CHANNEL_ID` and ignores a
            // per-notification sound, so it is left off there rather than
            // restated: below API 26 the plugin would resolve it as a raw
            // resource name, and `alarm_loop.mp3` is not the name of the
            // resource. Every other native platform reads the sound off the
            // notification, and the plugin documents that omitting it produces
            // *no sound at all* on iOS - an alarm that is armed, reported as
            // armed, and completely mute.
            sound: isAndroid() ? undefined : NOTIFICATION_SOUND,
            actionTypeId: actionType,
            isExactNotification: true,
            isExactMandatory: type === 'timer',
            ongoing: type === 'timer',
            autoCancel: true,
            extra: metadataFor(type, entityId, at),
        };
        const result: ScheduleResult = await LocalNotifications.schedule({ notifications: [notification] });
        // The plugin resolves with the ids it actually armed. A resolved call
        // whose list does not contain this id means nothing was registered, and
        // reporting success would leave the UI claiming a reminder that does not
        // exist. A missing list is not treated as a failure: the shape is not
        // something this service can second-guess, and inventing an error for it
        // would turn a working schedule into a spurious one.
        const armed = result?.notifications;
        if (Array.isArray(armed) && !armed.some((entry) => entry?.id === id)) {
            return { success: false, error: NOT_REGISTERED_ERROR };
        }
        const warning = typeof result?.warning?.message === 'string' ? result.warning.message : undefined;
        if (warning) {
            return { success: true, inexact: true, warning };
        }
        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: errorMessage(error) };
    }
};

export const NotificationService = {
    safeId,

    getNotificationId,

    async checkExactAlarmPermission(): Promise<boolean> {
        return getExactNotificationPermission();
    },

    /**
     * The exact-alarm answer with every state kept apart.
     *
     * `checkExactAlarmPermission` folds this into a boolean, which is the right
     * shape for "may I schedule?" and the wrong one for "should I prompt?": a
     * `unreadable` read is not a refusal, and a shell that answers this by
     * telling the user to go and grant the exact-alarm permission shows that
     * prompt after a bridge failure, to a user who has already granted it.
     */
    async getExactAlarmState(): Promise<ExactAlarmState> {
        return readExactAlarmState();
    },

    async checkExactNotificationPermission(): Promise<boolean> {
        return getExactNotificationPermission();
    },

    async openExactAlarmSettings(): Promise<boolean> {
        if (!Capacitor.isNativePlatform() || !isAndroid()) {
            return true;
        }
        try {
            // The plugin resolves this from the settings callback, so the answer is
            // the state the user just left the screen on rather than the old one.
            const result = await LocalNotifications.changeExactNotificationSetting();
            return result.exact_alarm === 'granted';
        } catch {
            return false;
        }
    },

    async getPackageName(): Promise<string> {
        return 'com.sumon.studytracker';
    },

    async requestPermissions(): Promise<boolean> {
        return requestDisplayPermission();
    },

    async initialize(): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            return;
        }

        // `createChannel` is Android-only and the iOS implementation answers
        // `unimplemented`. Calling it there rejects, and because the caller
        // swallows an `initialize()` failure it would skip `initListeners`
        // entirely - leaving iOS with scheduled reminders and no
        // `localNotificationActionPerformed` listener, so a tap never marks a
        // todo done and never stops the alarm.
        if (isAndroid()) {
            try {
                await LocalNotifications.createChannel({
                    id: NOTIFICATION_CHANNEL_ID,
                    name: 'Study Alarms (High Volume)',
                    description: 'Persistent and loud alarms for study tasks',
                    importance: 5,
                    visibility: NOTIFICATION_VISIBILITY,
                    vibration: true,
                    sound: NOTIFICATION_SOUND,
                });
            } catch (error: unknown) {
                // Without the channel the alarm is silent, and a swallowed failure
                // here would only surface much later as an unexplained schedule
                // error.
                throw new Error(`${INIT_FAILED_ERROR}: ${errorMessage(error)}`);
            }
        }

        // Registered on every native platform, and independently of the channel:
        // the action buttons come from these types, so losing them must not be
        // blamed on (or hidden behind) a channel failure.
        try {
            await LocalNotifications.registerActionTypes({
                types: [
                    {
                        id: 'TODO_ACTIONS',
                        actions: [{ id: 'mark-done', title: 'Mark as Done', foreground: true }],
                    },
                    {
                        id: 'ALARM_ACTIONS',
                        actions: [{ id: 'dismiss', title: 'Dismiss', foreground: false }],
                    },
                ],
            });
        } catch (error: unknown) {
            throw new Error(`${ACTION_TYPES_FAILED_ERROR}: ${errorMessage(error)}`);
        }
    },

    /**
     * What a received or acted-upon notification reports back.
     *
     * `type` is the entity the notification's own metadata names, not a value
     * the shell has to guess from `actionTypeId`. The two are independent on
     * purpose: a focus alarm and a subject reminder share the `ALARM_ACTIONS`
     * type, so a handler that branched on `actionType` could not tell them
     * apart, and a shell that invented a `FOCUS_ALARM` action type to do so
     * would never see it - no such type is registered with the plugin.
     *
     * Both callbacks are delivered *before* any device round trip the tap
     * triggers, and are never allowed to be skipped by one: the tap is what
     * stops the ringing alarm, and the plugin does not await what a listener
     * returns, so a listener that awaited the bridge first left the alarm
     * sounding for the length of a round trip and turned a cancel failure into
     * a dropped tap.
     */
    async initListeners(
        onActionCallback: (data: NotificationActionData) => void,
        onReceiveCallback: (data: NotificationReceiveData) => void,
    ): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            // Nothing this service arms in a browser goes through the plugin, so
            // neither event can ever arrive from one of its notifications.
            // Registering anyway would attach two plugin listeners that no
            // code path in this service can reach, and `removeAllListeners`
            // would then be the only thing keeping them from outliving the page.
            return;
        }
        const generation = notificationListenerGeneration + 1;
        notificationListenerGeneration = generation;
        const created: PluginListenerHandle[] = [];
        // Every handle is tracked from the moment it exists, so a listener that is
        // registered and then abandoned - by a newer init, or by a failing second
        // registration - is still removed.
        const discard = async (): Promise<void> => {
            const pending = created.splice(0, created.length);
            await Promise.all(pending.map((handle) => handle.remove().catch(() => undefined)));
        };

        try {
            await LocalNotifications.removeAllListeners();
            if (generation !== notificationListenerGeneration) {
                return;
            }
            created.push(
                await LocalNotifications.addListener('localNotificationReceived', (notification) => {
                    const { metadata, entityId } = resolveNotificationEntity(
                        notification.extra as Record<string, unknown> | undefined,
                    );
                    onReceiveCallback?.({
                        originalId: entityId ?? notification.id,
                        actionType: notification.actionTypeId,
                        type: metadata?.type ?? null,
                        entityId,
                    });
                }),
            );
            if (generation !== notificationListenerGeneration) {
                await discard();
                return;
            }
            created.push(
                await LocalNotifications.addListener('localNotificationActionPerformed', (performed) => {
                    const { metadata, entityId } = resolveNotificationEntity(
                        performed.notification.extra as Record<string, unknown> | undefined,
                    );
                    // Without metadata the entity behind the notification is unknown,
                    // and hashing the notification id would cancel a stranger's alarm.
                    // The action is still reported so the tap is never swallowed.
                    const originalId = entityId ?? performed.notification.id;
                    // Reported first and unconditionally: this is what stops the
                    // alarm and marks the todo, and it must not wait on - or be
                    // lost to - a device round trip.
                    onActionCallback?.({
                        originalId,
                        actionId: performed.actionId,
                        actionType: performed.notification.actionTypeId ?? '',
                        type: metadata?.type ?? null,
                        entityId,
                    });
                    // The entity *type* decides whether the tap auto-cancels, not the
                    // action type: `TODO_ACTIONS` is registered for todo reminders
                    // only, but a caller can pass any action type to
                    // `scheduleTodoNotification`, and `mark-done` is the action id
                    // rather than the type. Keying off the metadata means the
                    // behaviour follows the entity the notification was armed for.
                    if (entityId === undefined || metadata?.type !== 'todo') {
                        return;
                    }
                    // Fire-and-forget after the fact: the alarm is already cleared
                    // from the app's side, and the plugin never awaits a listener,
                    // so a rejection here has to be absorbed here or it surfaces as
                    // an unhandled promise rejection inside the bridge.
                    void NotificationService.cancelTodoNotification(entityId).catch(() => undefined);
                }),
            );
        } catch (error: unknown) {
            await discard();
            throw error;
        }

        if (generation !== notificationListenerGeneration) {
            await discard();
            return;
        }
        // The previous init's handles are released rather than overwritten by the
        // commit below. `removeAllListeners` at the top of this method already
        // unregistered them plugin-side, but the handle *objects* are this
        // service's only reference to those registrations, and dropping them on
        // the floor leaves them alive for the life of the page.
        const superseded = notificationListenerHandles.splice(0, notificationListenerHandles.length);
        await Promise.all(superseded.map((handle) => handle.remove().catch(() => undefined)));
        notificationListenerHandles.push(...created);
    },

    /**
     * Drops every listener this service registered and cancels any init that is
     * still in flight, so an abandoned registration can never be committed
     * after the caller has already torn down.
     */
    async removeListeners(): Promise<void> {
        notificationListenerGeneration += 1;
        const handles = notificationListenerHandles.splice(0, notificationListenerHandles.length);
        await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
    },

    async scheduleNotification(
        originalId: string | number,
        title: string,
        body: string,
        date: Date | number | string,
        actionType = 'ALARM_ACTIONS',
        type: NotificationEntityType = 'subject',
    ): Promise<SessionNotificationScheduleResult> {
        const target = toInstant(date);
        if (!target) {
            return { success: false, error: INVALID_DATE_ERROR };
        }
        if (!Capacitor.isNativePlatform()) {
            return this.scheduleWebNotification(originalId, title, body, target, actionType, type);
        }
        return scheduleNativeNotification({ type, entityId: originalId, title, body, at: target, actionType });
    },

    async scheduleSubjectNotification(
        id: string | number,
        title: string,
        body: string,
        date: Date,
        actionType = 'ALARM_ACTIONS',
    ): Promise<SessionNotificationScheduleResult> {
        return this.scheduleNotification(id, title, body, date, actionType, 'subject');
    },

    async scheduleTodoNotification(
        id: string | number,
        title: string,
        body: string,
        hour: number,
        minute: number,
        actionType = 'TODO_ACTIONS',
    ): Promise<SessionNotificationScheduleResult> {
        return this.scheduleDailyNotification(id, title, body, hour, minute, actionType, 'todo');
    },

    /**
     * Arms a reminder for its next daily occurrence. The web path keeps a real
     * daily series alive in this tab; the native path arms a single exact alarm
     * and relies on the reconcile pass to arm the following day.
     */
    async scheduleDailyNotification(
        originalId: string | number,
        title: string,
        body: string,
        hour: number,
        minute: number,
        actionType = 'TODO_ACTIONS',
        type: NotificationEntityType = 'todo',
    ): Promise<SessionNotificationScheduleResult> {
        let target: Date;
        try {
            target = getNextDailyReminderDate(hour, minute);
        } catch (error: unknown) {
            return { success: false, error: errorMessage(error) };
        }
        if (!Capacitor.isNativePlatform()) {
            return scheduleWebReminder(type, originalId, title, body, target, true, actionType, true);
        }
        return scheduleNativeNotification({ type, entityId: originalId, title, body, at: target, actionType });
    },

    /**
     * Whether the alarm is no longer *armed* on the device.
     *
     * That is the question this answer is for, and it is the question the shell
     * asks: `TrackerForm` unsets a subject's reminder on `true` and leaves it
     * set on `false`. Clearing the copy that is already on the shade is
     * therefore best-effort and deliberately not folded in - a stale shade row
     * is not an armed alarm, and reporting the cancel as failed over it would
     * leave the UI claiming a reminder is still going to ring.
     */
    async cancelNotification(originalId: string | number, type: NotificationEntityType = 'subject'): Promise<boolean> {
        clearWebReminders(type, originalId);
        return cancelNativeIds(nativeIdsFor(type, originalId));
    },

    /**
     * Whether the sweep took the alarms *and* the shade.
     *
     * The whole-shade clear is the deliverable here, not just the arming, so
     * this answer is deliberately stricter than `cancelNotification`'s: a
     * delivered notification whose record the plugin no longer tracks cannot
     * be reached by id, and the shade is swept in one call to cover it. Both
     * branches report that, so a caller cannot get one meaning from one branch
     * and the other from the other.
     */
    async cancelAllNotifications(): Promise<boolean> {
        clearWebReminders();
        if (!Capacitor.isNativePlatform()) {
            return true;
        }
        const cancelAll = (LocalNotifications as unknown as { cancelAll?: () => Promise<void> }).cancelAll;
        if (typeof cancelAll === 'function') {
            let cancelled = true;
            try {
                await cancelAll();
            } catch {
                cancelled = false;
            }
            // `getPending` only knows what the plugin still tracks, so an id-based
            // clear would leave behind a delivered notification whose record is
            // already gone. Clearing the shade in one call covers both.
            return cancelled && (await removeAllDeliveredNative());
        }
        const pending = await queryPendingNotifications();
        if (pending === null) {
            return false;
        }
        // Same sweep as the branch above, for the same reason: the per-id clear
        // only reaches ids the plugin still lists.
        return (
            (await cancelNativeIds(pending.map((notification) => notification.id))) &&
            (await removeAllDeliveredNative())
        );
    },

    async cancelSubjectNotification(id: string | number): Promise<boolean> {
        return this.cancelNotification(id, 'subject');
    },

    async cancelTodoNotification(id: string | number): Promise<boolean> {
        return this.cancelNotification(id, 'todo');
    },

    async cancelTimerNotifications(): Promise<boolean> {
        clearWebReminders('timer', TIMER_NOTIFICATION_ID);
        return cancelNativeIds([TIMER_NOTIFICATION_ID]);
    },

    async cancelWebNotification(type: NotificationEntityType, entityId: string | number): Promise<boolean> {
        clearWebReminders(type, entityId);
        return true;
    },

    async checkPermissions(): Promise<boolean> {
        return getNotificationPermission();
    },

    /**
     * The records the plugin still tracks, with the read's own outcome.
     *
     * An earlier version answered this with a bare list and filled a failed
     * read with `[]`, which is the one answer a caller must never act on: an
     * empty list says "nothing is scheduled", so a bridge failure was read as
     * "every reminder is gone" - and the natural things to do with that answer
     * (re-arm everything, stop warning the user) are the exact opposite of what
     * a failure warrants. `ok` keeps the two apart; `notifications` is only
     * meaningful when it is `true`.
     */
    async getPending(): Promise<PendingNotificationRead> {
        const pending = await queryPendingNotifications();
        return pending
            ? { ok: true, notifications: pending }
            : { ok: false, notifications: [], error: PENDING_UNREADABLE_ERROR };
    },

    async scheduleWebNotification(
        originalId: string | number,
        title: string,
        body: string,
        date: Date | number | string = new Date(),
        actionType: string | number = 'ALARM_ACTIONS',
        type: NotificationEntityType = 'subject',
    ): Promise<SessionNotificationScheduleResult> {
        const target = toInstant(date);
        if (!target) {
            return { success: false, error: INVALID_DATE_ERROR };
        }
        const resolvedActionType =
            typeof actionType === 'string' && actionType.length > 0 ? actionType : 'ALARM_ACTIONS';
        return scheduleWebReminder(type, originalId, title, body, target, false, resolvedActionType, true);
    },

    async reconcileSubjectNotifications(
        definitions: SubjectNotificationDefinition[] = [],
        date = localDateKey(new Date()),
    ): Promise<SessionNotificationScheduleResult> {
        // A subject reminder belongs to one specific day, so a pass for any other
        // day has nothing to arm and must not touch the alarms of the day that
        // *is* armed. This is a deliberate no-op, not a completed reconcile: it
        // neither schedules nor cancels, and the caller re-runs the pass once the
        // selected day has actually been loaded. `skipped` is what keeps that
        // apart from a pass that really did arm everything - see
        // `SessionNotificationScheduleResult.skipped`, and note that this
        // result is aggregated with the todo pass, where a bare `success: true`
        // would have hidden the skip entirely.
        if (date !== localDateKey(new Date())) {
            return { success: true, skipped: true };
        }
        const desiredIds = new Set(definitions.map((definition) => String(definition.id)));
        if (!Capacitor.isNativePlatform()) {
            // Armed first, leftovers swept afterwards, so a definition that fails
            // to re-arm does not take the working reminder it replaced with it.
            const armed = new Set<string>();
            const results: SessionNotificationScheduleResult[] = [];
            for (const definition of definitions) {
                const target = definition.date instanceof Date ? definition.date : dateFromKey(definition.date);
                if (Number.isNaN(target.getTime())) {
                    results.push({ success: false, error: INVALID_DATE_ERROR });
                    continue;
                }
                // Kept even once the occurrence has passed, so a reminder that
                // fired a moment ago keeps its handle and stays closable.
                armed.add(webReminderKey('subject', definition.id));
                if (target.getTime() <= Date.now()) {
                    continue;
                }
                results.push(
                    await scheduleWebReminder(
                        'subject',
                        definition.id,
                        definition.title,
                        definition.body,
                        target,
                        false,
                        definition.actionType ?? 'ALARM_ACTIONS',
                        false,
                    ),
                );
            }
            clearStaleWebReminders('subject', armed);
            return aggregateResults(results);
        }

        const results: SessionNotificationScheduleResult[] = [await reconcilePending('subject', desiredIds)];
        for (const definition of definitions) {
            const target = definition.date instanceof Date ? definition.date : dateFromKey(definition.date);
            if (Number.isNaN(target.getTime())) {
                results.push({ success: false, error: INVALID_DATE_ERROR });
                continue;
            }
            if (target.getTime() <= Date.now()) {
                continue;
            }
            results.push(
                await scheduleNativeNotification({
                    type: 'subject',
                    entityId: definition.id,
                    title: definition.title,
                    body: definition.body,
                    at: target,
                    actionType: definition.actionType ?? 'ALARM_ACTIONS',
                }),
            );
        }
        return aggregateResults(results);
    },

    /**
     * Arms the next occurrence of every daily reminder.
     *
     * `date` is accepted only so the signature matches the subject pass and
     * `reconcileNotifications`; it is deliberately not used. A todo reminder is a
     * wall-clock time, not an instant on a particular day, so it stays armed
     * whatever day is selected in the UI - unlike a subject reminder, which the
     * pass above skips. Every occurrence is re-armed from scratch here, which is
     * also what rolls a daily reminder over to the next day after it fires.
     */
    async reconcileTodoNotifications(
        definitions: TodoNotificationDefinition[] = [],
        _date = localDateKey(new Date()),
    ): Promise<SessionNotificationScheduleResult> {
        const desiredIds = new Set(definitions.map((definition) => String(definition.id)));
        if (!Capacitor.isNativePlatform()) {
            // Armed first, leftovers swept afterwards, for the same reason as the
            // subject pass: a daily reminder that fails to re-arm must not be
            // dropped by the pass that was supposed to move it.
            const armed = new Set<string>();
            const results: SessionNotificationScheduleResult[] = [];
            for (const definition of definitions) {
                let target: Date;
                try {
                    target = getNextDailyReminderDate(definition.hour, definition.minute);
                } catch (error: unknown) {
                    results.push({ success: false, error: errorMessage(error) });
                    continue;
                }
                armed.add(webReminderKey('todo', definition.id));
                results.push(
                    await scheduleWebReminder(
                        'todo',
                        definition.id,
                        definition.title,
                        definition.body,
                        target,
                        true,
                        definition.actionType ?? 'TODO_ACTIONS',
                        false,
                    ),
                );
            }
            clearStaleWebReminders('todo', armed);
            return aggregateResults(results);
        }

        const results: SessionNotificationScheduleResult[] = [await reconcilePending('todo', desiredIds)];
        for (const definition of definitions) {
            let target: Date;
            try {
                // A corrupt stored time must fail this one reminder, not reject the
                // whole pass and take the subject result down with it.
                target = getNextDailyReminderDate(definition.hour, definition.minute);
            } catch (error: unknown) {
                results.push({ success: false, error: errorMessage(error) });
                continue;
            }
            results.push(
                await scheduleNativeNotification({
                    type: 'todo',
                    entityId: definition.id,
                    title: definition.title,
                    body: definition.body,
                    at: target,
                    actionType: definition.actionType ?? 'TODO_ACTIONS',
                }),
            );
        }
        return aggregateResults(results);
    },

    async reconcileNotifications(
        subjects: SubjectNotificationDefinition[],
        todos: TodoNotificationDefinition[],
        date = localDateKey(new Date()),
    ): Promise<SessionNotificationScheduleResult> {
        const subjectResult = await this.reconcileSubjectNotifications(subjects, date);
        const todoResult = await this.reconcileTodoNotifications(todos, date);
        return aggregateResults([subjectResult, todoResult]);
    },
};

export const checkExactAlarmPermission = (): Promise<boolean> => NotificationService.checkExactAlarmPermission();
export const checkExactNotificationPermission = (): Promise<boolean> =>
    NotificationService.checkExactNotificationPermission();
export const getExactAlarmState = (): Promise<ExactAlarmState> => NotificationService.getExactAlarmState();
export const changeExactNotificationSetting = (): Promise<boolean> => NotificationService.openExactAlarmSettings();
export const checkExactNotificationSetting = (): Promise<boolean> => NotificationService.checkExactAlarmPermission();
export const recheckExactAlarmPermission = (): Promise<boolean> => NotificationService.checkExactAlarmPermission();
export const cancelSubjectNotification = (id: string | number): Promise<boolean> =>
    NotificationService.cancelSubjectNotification(id);
export const cancelTodoNotification = (id: string | number): Promise<boolean> =>
    NotificationService.cancelTodoNotification(id);
export const reconcileSubjectNotifications = (
    definitions: SubjectNotificationDefinition[] = [],
    date?: string,
): Promise<SessionNotificationScheduleResult> => NotificationService.reconcileSubjectNotifications(definitions, date);
export const reconcileTodoNotifications = (
    definitions: TodoNotificationDefinition[] = [],
    date?: string,
): Promise<SessionNotificationScheduleResult> => NotificationService.reconcileTodoNotifications(definitions, date);
export const reconcileNotifications = (
    subjects: SubjectNotificationDefinition[],
    todos: TodoNotificationDefinition[],
    date?: string,
): Promise<SessionNotificationScheduleResult> => NotificationService.reconcileNotifications(subjects, todos, date);

/**
 * One record as the plugin reports it back. This is not necessarily a *pending*
 * alarm: Android keeps the stored record of an alarm that already fired so it
 * stays queryable through `getByIds`/`getAll`, and `getPending` does not filter
 * those out. `schedule` is what distinguishes the two.
 */
export interface LocalNotification {
    id: number;
    title?: string;
    body?: string;
    extra?: Record<string, unknown>;
    schedule?: Schedule;
}

/**
 * The outcome of asking the plugin what it still tracks.
 *
 * `ok: false` means the list is *unknown*, not empty - the two look identical
 * once they have been flattened into an array, and the difference is the whole
 * point of the shape.
 */
export interface PendingNotificationRead {
    ok: boolean;
    /** Only meaningful while `ok` is `true`; always an empty list otherwise. */
    notifications: LocalNotification[];
    /** Set only when `ok` is `false`. */
    error?: string;
}
