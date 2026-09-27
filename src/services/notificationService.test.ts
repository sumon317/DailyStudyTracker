import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    native: false,
    platform: 'web',
    notifications: {
        checkPermissions: vi.fn(),
        requestPermissions: vi.fn(),
        checkExactNotificationSetting: vi.fn(),
        changeExactNotificationSetting: vi.fn(),
        createChannel: vi.fn(),
        registerActionTypes: vi.fn(),
        removeAllListeners: vi.fn(),
        addListener: vi.fn(),
        schedule: vi.fn(),
        cancel: vi.fn(),
        getPending: vi.fn(),
        removeDeliveredNotificationsById: vi.fn(),
    },
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => mocks.native,
        getPlatform: () => mocks.platform,
    },
}));

vi.mock('@capacitor/local-notifications', () => ({
    LocalNotifications: mocks.notifications,
}));

/**
 * The alarm tone, replaced with a recorder.
 *
 * A web reminder is an alarm, not a line of text, so it plays the same
 * `createAlarmAudio` controller the shell and the countdown timer use. The real
 * module is replaced rather than the audio element underneath it so the test can
 * see the controller's whole lifecycle - including `dispose`, which is what
 * releases a looping tone and its `MediaElementSource`.
 */
const audioMocks = vi.hoisted(() => ({ instances: [] as Array<Record<string, ReturnType<typeof vi.fn>>> }));

vi.mock('./alarmAudio', () => ({
    createAlarmAudio: () => {
        const controller = {
            play: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn(),
            dispose: vi.fn(),
        };
        audioMocks.instances.push(controller);
        return controller;
    },
}));

import {
    changeExactNotificationSetting,
    getNextDailyReminderDate,
    getNotificationId,
    NOTIFICATION_CHANNEL_ID,
    NOTIFICATION_ICON,
    NOTIFICATION_SOUND,
    NOTIFICATION_VISIBILITY,
    NotificationService,
    recheckExactAlarmPermission,
    safeId,
    TIMER_NOTIFICATION_ID,
} from './notificationService';

const ANDROID_ID_MAX = 0x7fffffff;

const localDateKey = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Every notification handed to `schedule` so far, in call order. */
const scheduledNotifications = (): Array<Record<string, unknown>> =>
    mocks.notifications.schedule.mock.calls.flatMap((call) => call[0]?.notifications ?? []);

const onlyScheduledNotification = (): Record<string, unknown> | undefined => scheduledNotifications()[0];

interface MockNotificationInstance {
    title: string;
    close: ReturnType<typeof vi.fn>;
    onclick: (() => void) | null;
}

/**
 * A `Notification` stand-in that records every instance, so a test can assert on
 * how many reminders actually reached the user and which one was superseded.
 *
 * `permission` is the state the page starts in, `requestResult` what the browser
 * answers when asked - they differ whenever a test is exercising the prompt.
 */
const installMockNotification = (
    permission: NotificationPermission = 'granted',
    requestResult: NotificationPermission = 'granted',
) => {
    const instances: MockNotificationInstance[] = [];
    const requestPermission = vi.fn().mockResolvedValue(requestResult);
    class MockNotification {
        static permission = permission;
        static requestPermission = requestPermission;
        close = vi.fn();
        onclick: (() => void) | null = null;
        constructor(public title: string) {
            instances.push(this);
        }
    }
    vi.stubGlobal('Notification', MockNotification);
    return { instances, requestPermission };
};

const useAndroid = (): void => {
    mocks.native = true;
    mocks.platform = 'android';
};

const armAndroidPermissions = (): void => {
    mocks.notifications.checkPermissions.mockResolvedValue({ display: 'granted' });
    mocks.notifications.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
};

describe('NotificationService', () => {
    beforeEach(() => {
        mocks.native = false;
        mocks.platform = 'web';
        vi.clearAllMocks();
        audioMocks.instances.length = 0;
        mocks.notifications.checkPermissions.mockResolvedValue({ display: 'granted' });
        mocks.notifications.requestPermissions.mockResolvedValue({ display: 'granted' });
        mocks.notifications.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
        mocks.notifications.changeExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
        mocks.notifications.createChannel.mockResolvedValue(undefined);
        mocks.notifications.registerActionTypes.mockResolvedValue(undefined);
        mocks.notifications.removeAllListeners.mockResolvedValue(undefined);
        mocks.notifications.addListener.mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });
        // A real `schedule` resolves with the ids it armed. Echoing the requested
        // id back is what lets the service tell "armed" apart from "resolved".
        mocks.notifications.schedule.mockImplementation(
            async ({ notifications }: { notifications: Array<{ id: number }> }) => ({
                notifications: notifications.map((notification) => ({ id: notification.id })),
            }),
        );
        mocks.notifications.cancel.mockResolvedValue(undefined);
        mocks.notifications.removeDeliveredNotificationsById.mockResolvedValue(undefined);
        mocks.notifications.getPending.mockResolvedValue({ notifications: [] });
        // `cancelAll`/`removeAllDeliveredNotifications` are the fallback
        // candidates: absent by default so the per-id path is the baseline, and
        // added back per test by the cases that exercise them. The service
        // feature-detects them by `typeof === 'function'`, so clearing them to
        // `undefined` is equivalent to them not existing.
        (mocks.notifications as Record<string, unknown>).cancelAll = undefined;
        (mocks.notifications as Record<string, unknown>).removeAllDeliveredNotifications = undefined;
    });

    afterEach(async () => {
        // The service keeps module-level web timers and listener handles, so the
        // defaults have to be torn down per test or a leaked reminder fires in
        // the next one.
        await NotificationService.cancelAllNotifications();
        await NotificationService.removeListeners();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe('safeId', () => {
        it('returns a stable positive 31-bit integer', () => {
            const first = safeId('subject:42');
            expect(first).toBe(safeId('subject:42'));
            expect(first).toBeGreaterThan(0);
            expect(first).toBeLessThanOrEqual(0x7fffffff);
        });

        it('keeps notification namespaces separate for normal inputs', () => {
            expect(getNotificationId('subject', 42)).not.toBe(getNotificationId('todo', 42));
            expect(getNotificationId('subject', 42)).toBeLessThanOrEqual(0x7fffffff);
        });

        it('never allocates the reserved countdown timer id to a scheduled entity', () => {
            for (let entityId = 0; entityId < 2000; entityId += 1) {
                expect(getNotificationId('subject', entityId)).not.toBe(TIMER_NOTIFICATION_ID);
                expect(getNotificationId('todo', entityId)).not.toBe(TIMER_NOTIFICATION_ID);
                expect(getNotificationId('focus-alarm', entityId)).not.toBe(TIMER_NOTIFICATION_ID);
            }
        });

        it('keeps every id inside the range Android accepts, whatever the entity id looks like', () => {
            const entityIds: Array<string | number> = [
                0,
                -1,
                '',
                '   ',
                'focus-a',
                1e15,
                Number.MAX_SAFE_INTEGER,
                'x'.repeat(512),
            ];
            for (const type of ['subject', 'todo', 'focus-alarm'] as const) {
                for (const entityId of entityIds) {
                    const id = getNotificationId(type, entityId);
                    expect(Number.isInteger(id), `${type}:${entityId}`).toBe(true);
                    expect(id, `${type}:${entityId}`).toBeGreaterThan(0);
                    expect(id, `${type}:${entityId}`).toBeLessThanOrEqual(ANDROID_ID_MAX);
                }
            }
        });

        it('does not hand the same id to two different entities', () => {
            // A collision would leave one of the two reminders permanently
            // unarmed while the other fires twice, so the namespaces are checked
            // over a realistic id range rather than a couple of samples.
            const seen = new Map<number, string>();
            for (const type of ['subject', 'todo', 'focus-alarm'] as const) {
                for (let entityId = 0; entityId < 3000; entityId += 1) {
                    const id = getNotificationId(type, entityId);
                    const key = `${type}:${entityId}`;
                    expect(seen.has(id), `${key} collides with ${seen.get(id) ?? ''}`).toBe(false);
                    seen.set(id, key);
                }
            }
        });
    });

    describe('exact alarm permission', () => {
        it('uses Capacitor 8 exact_alarm status APIs', async () => {
            useAndroid();
            mocks.notifications.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'denied' });
            await expect(NotificationService.checkExactAlarmPermission()).resolves.toBe(false);
            expect(mocks.notifications.checkExactNotificationSetting).toHaveBeenCalledTimes(1);

            mocks.notifications.changeExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
            await expect(NotificationService.openExactAlarmSettings()).resolves.toBe(true);
            expect(mocks.notifications.changeExactNotificationSetting).toHaveBeenCalledTimes(1);
        });

        it('re-reads the setting after the round trip through the settings screen', async () => {
            useAndroid();
            // First read says denied, the settings screen grants it, and only the
            // next read knows. A cached answer would keep showing the prompt to
            // a user who already granted it, forever.
            mocks.notifications.checkExactNotificationSetting
                .mockResolvedValueOnce({ exact_alarm: 'denied' })
                .mockResolvedValue({ exact_alarm: 'granted' });
            await expect(NotificationService.checkExactAlarmPermission()).resolves.toBe(false);

            mocks.notifications.changeExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
            await expect(changeExactNotificationSetting()).resolves.toBe(true);
            await expect(recheckExactAlarmPermission()).resolves.toBe(true);
            expect(mocks.notifications.checkExactNotificationSetting).toHaveBeenCalledTimes(2);
        });

        it('reports the grant the user just revoked on the settings screen', async () => {
            useAndroid();
            mocks.notifications.changeExactNotificationSetting.mockResolvedValue({ exact_alarm: 'denied' });
            await expect(NotificationService.openExactAlarmSettings()).resolves.toBe(false);
        });

        it('never asks a platform that has no exact-alarm setting', async () => {
            // The plugin answers `unimplemented` for `checkExactNotificationSetting`
            // on iOS and has no web build at all. Reporting "not granted" there
            // would show a prompt the user cannot act on.
            await expect(NotificationService.checkExactAlarmPermission()).resolves.toBe(true);
            expect(mocks.notifications.checkExactNotificationSetting).not.toHaveBeenCalled();

            mocks.native = true;
            mocks.platform = 'ios';
            await expect(NotificationService.checkExactAlarmPermission()).resolves.toBe(true);
            expect(mocks.notifications.checkExactNotificationSetting).not.toHaveBeenCalled();

            await expect(NotificationService.openExactAlarmSettings()).resolves.toBe(true);
            expect(mocks.notifications.changeExactNotificationSetting).not.toHaveBeenCalled();
        });

        it('does not claim a bridge failure is a denial', async () => {
            useAndroid();
            mocks.notifications.checkExactNotificationSetting.mockRejectedValue(new Error('bridge down'));
            // The single boolean has to fold the unreadable state into "not
            // granted"; the schedule path is where the distinction survives.
            await expect(NotificationService.checkExactAlarmPermission()).resolves.toBe(false);
        });

        it('keeps the unreadable state apart from a real refusal', async () => {
            useAndroid();
            // The boolean cannot express this, and it is the difference between
            // "tell the user to grant a permission" and "we could not check".
            // A shell that prompts off the boolean shows the exact-alarm prompt
            // to a user who has already granted it, whenever a bridge read
            // fails.
            mocks.notifications.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'denied' });
            await expect(NotificationService.getExactAlarmState()).resolves.toBe('denied');

            mocks.notifications.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
            await expect(NotificationService.getExactAlarmState()).resolves.toBe('granted');

            mocks.notifications.checkExactNotificationSetting.mockRejectedValue(new Error('bridge down'));
            await expect(NotificationService.getExactAlarmState()).resolves.toBe('unreadable');
        });

        it('does not call a platform that does not ask a granted exact alarm', async () => {
            // Off Android nobody made a grant; the platform does not ask. Saying
            // `granted` would put a grant in the user's mouth, and saying
            // `denied` would show a prompt they cannot act on.
            await expect(NotificationService.getExactAlarmState()).resolves.toBe('not-applicable');
            mocks.native = true;
            mocks.platform = 'ios';
            await expect(NotificationService.getExactAlarmState()).resolves.toBe('not-applicable');
        });
    });

    describe('display permission', () => {
        it('reports the permission and never treats a failed read as consent', async () => {
            useAndroid();
            mocks.notifications.checkPermissions.mockResolvedValue({ display: 'granted' });
            await expect(NotificationService.checkPermissions()).resolves.toBe(true);

            mocks.notifications.checkPermissions.mockResolvedValue({ display: 'denied' });
            await expect(NotificationService.checkPermissions()).resolves.toBe(false);

            mocks.notifications.checkPermissions.mockRejectedValue(new Error('bridge down'));
            await expect(NotificationService.checkPermissions()).resolves.toBe(false);
        });

        it('requests the permission on demand', async () => {
            useAndroid();
            mocks.notifications.requestPermissions.mockResolvedValue({ display: 'granted' });
            await expect(NotificationService.requestPermissions()).resolves.toBe(true);
            expect(mocks.notifications.requestPermissions).toHaveBeenCalledTimes(1);

            mocks.notifications.requestPermissions.mockResolvedValue({ display: 'denied' });
            await expect(NotificationService.requestPermissions()).resolves.toBe(false);
        });

        it('prompts exactly once when the permission is still unanswered', async () => {
            useAndroid();
            armAndroidPermissions();
            mocks.notifications.checkPermissions.mockResolvedValue({ display: 'prompt' });
            const result = await NotificationService.scheduleSubjectNotification(
                12,
                'Subject',
                'Body',
                new Date(Date.now() + 60_000),
            );
            expect(result.success).toBe(true);
            expect(mocks.notifications.requestPermissions).toHaveBeenCalledTimes(1);
        });

        it('refuses to arm a reminder when the permission is refused', async () => {
            useAndroid();
            armAndroidPermissions();
            mocks.notifications.checkPermissions.mockResolvedValue({ display: 'denied' });
            mocks.notifications.requestPermissions.mockResolvedValue({ display: 'denied' });
            const result = await NotificationService.scheduleSubjectNotification(
                12,
                'Subject',
                'Body',
                new Date(Date.now() + 60_000),
            );
            expect(result).toEqual({ success: false, error: 'Notification permission not granted' });
            expect(mocks.notifications.schedule).not.toHaveBeenCalled();
        });

        it('reports an unreadable permission instead of blaming the user for it', async () => {
            useAndroid();
            armAndroidPermissions();
            mocks.notifications.checkPermissions.mockRejectedValue(new Error('bridge down'));
            mocks.notifications.requestPermissions.mockRejectedValue(new Error('bridge down'));
            const result = await NotificationService.scheduleSubjectNotification(
                12,
                'Subject',
                'Body',
                new Date(Date.now() + 60_000),
            );
            expect(result).toEqual({
                success: false,
                error: 'Unable to read the notification permission on this device',
            });
            expect(mocks.notifications.schedule).not.toHaveBeenCalled();
        });

        it('refuses to arm an exact alarm it could not verify', async () => {
            useAndroid();
            armAndroidPermissions();
            mocks.notifications.checkExactNotificationSetting.mockRejectedValue(new Error('bridge down'));
            const result = await NotificationService.scheduleSubjectNotification(
                12,
                'Subject',
                'Body',
                new Date(Date.now() + 60_000),
            );
            expect(result).toEqual({
                success: false,
                error: 'Unable to read the exact alarm setting on this device',
            });
            expect(mocks.notifications.schedule).not.toHaveBeenCalled();
        });
    });

    describe('initialization', () => {
        it('creates the loud private channel and registers both action types on Android', async () => {
            useAndroid();
            await NotificationService.initialize();
            expect(mocks.notifications.createChannel).toHaveBeenCalledWith({
                id: NOTIFICATION_CHANNEL_ID,
                name: 'Study Alarms (High Volume)',
                description: 'Persistent and loud alarms for study tasks',
                importance: 5,
                visibility: NOTIFICATION_VISIBILITY,
                vibration: true,
                sound: NOTIFICATION_SOUND,
            });
            const types = mocks.notifications.registerActionTypes.mock.calls[0]?.[0]?.types as Array<{
                id: string;
                actions: Array<{ id: string; foreground: boolean }>;
            }>;
            expect(types.map((type) => type.id)).toEqual(['TODO_ACTIONS', 'ALARM_ACTIONS']);
            expect(types[0]?.actions).toEqual([{ id: 'mark-done', title: 'Mark as Done', foreground: true }]);
            expect(types[1]?.actions).toEqual([{ id: 'dismiss', title: 'Dismiss', foreground: false }]);
        });

        it('registers the action types on iOS, where the channel call does not exist', async () => {
            mocks.native = true;
            mocks.platform = 'ios';
            // `createChannel` answers `unimplemented` on iOS. Calling it anyway
            // would reject, and the caller swallows an `initialize()` failure -
            // which would leave iOS with reminders scheduled and no action
            // listener at all.
            mocks.notifications.createChannel.mockRejectedValue(new Error('not implemented'));
            await expect(NotificationService.initialize()).resolves.toBeUndefined();
            expect(mocks.notifications.createChannel).not.toHaveBeenCalled();
            expect(mocks.notifications.registerActionTypes).toHaveBeenCalledTimes(1);
        });

        it('surfaces a channel failure instead of arming silent alarms', async () => {
            useAndroid();
            mocks.notifications.createChannel.mockRejectedValue(new Error('channel blocked'));
            await expect(NotificationService.initialize()).rejects.toThrow(
                'Unable to prepare notifications on this device',
            );
        });

        it('surfaces an action-type failure, which is not the channel talking', async () => {
            useAndroid();
            mocks.notifications.registerActionTypes.mockRejectedValue(new Error('actions blocked'));
            await expect(NotificationService.initialize()).rejects.toThrow(
                'Unable to register the notification actions on this device',
            );
        });

        it('does nothing at all in a browser', async () => {
            await NotificationService.initialize();
            expect(mocks.notifications.createChannel).not.toHaveBeenCalled();
            expect(mocks.notifications.registerActionTypes).not.toHaveBeenCalled();
        });
    });

    describe('daily reminders', () => {
        it('uses today when the requested time is still upcoming', () => {
            const now = new Date(2026, 8, 25, 10, 0, 0);
            const target = getNextDailyReminderDate(11, 30, now);
            expect(target.getFullYear()).toBe(2026);
            expect(target.getMonth()).toBe(8);
            expect(target.getDate()).toBe(25);
            expect(target.getHours()).toBe(11);
            expect(target.getMinutes()).toBe(30);
        });

        it('uses tomorrow when today has passed', () => {
            const now = new Date(2026, 8, 25, 23, 59, 0);
            const target = getNextDailyReminderDate(8, 0, now);
            expect(target.getDate()).toBe(26);
        });

        it('refuses a time that is not a clock time', () => {
            expect(() => getNextDailyReminderDate(24, 0)).toThrow(RangeError);
            expect(() => getNextDailyReminderDate(0, 60)).toThrow(RangeError);
            expect(() => getNextDailyReminderDate(11.5, 0)).toThrow(RangeError);
        });
    });

    describe('web session reminders', () => {
        it('retains and cancels timeout handles without claiming closed-tab delivery', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            const { instances, requestPermission } = installMockNotification('default', 'granted');

            const result = await NotificationService.scheduleTodoNotification(7, 'Todo', 'Body', 11, 0);
            expect(result.success).toBe(true);
            expect(result.sessionOnly).toBe(true);
            expect(result.reliableOnlyWhileOpen).toBe(true);
            expect(requestPermission).toHaveBeenCalledTimes(1);

            await NotificationService.cancelTodoNotification(7);
            await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
            expect(instances).toHaveLength(0);
        });

        it('repeats at the same wall-clock time and retires the superseded copy', async () => {
            vi.useFakeTimers();
            // December: no daylight-saving transition anywhere in that week, so
            // the day count below is not at the mercy of the runner's timezone.
            vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0));
            const { instances } = installMockNotification();

            await NotificationService.scheduleTodoNotification(7, 'Todo', 'Body', 11, 0);
            await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
            expect(instances).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
            expect(instances).toHaveLength(2);
            // The browser replaces a notification carrying the same tag, so the
            // previous day's handle is closed rather than left alive and on screen.
            expect(instances[0]?.close).toHaveBeenCalledTimes(1);
            expect(instances[1]?.close).not.toHaveBeenCalled();

            await NotificationService.cancelTodoNotification(7);
            expect(instances[1]?.close).toHaveBeenCalledTimes(1);
        });

        it('stops the series at the first cancel instead of firing on later days', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0));
            const { instances } = installMockNotification();

            await NotificationService.scheduleTodoNotification(7, 'Todo', 'Body', 11, 0);
            await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
            expect(instances).toHaveLength(1);

            await NotificationService.cancelTodoNotification(7);
            await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000);
            expect(instances).toHaveLength(1);
        });

        it('fires once for a window a suspended tab slept through, not the whole backlog', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0));
            const { instances } = installMockNotification();

            // A backgrounded tab has its timers coalesced, so the callback for
            // 11:00 only runs once the tab wakes much later. The clock the code
            // reads is moved three days ahead while the timer queue is left
            // alone, which is that situation exactly: the timer comes due at
            // once and the callback finds a `now` three days on.
            const clockNow = Date.now.bind(Date);
            const threeDays = 3 * 24 * 60 * 60 * 1000;
            vi.spyOn(Date, 'now').mockImplementation(() => clockNow() + threeDays);

            await NotificationService.scheduleTodoNotification(7, 'Todo', 'Body', 11, 0);
            await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

            // One reminder for the three missed days, then the next real
            // occurrence - and the earlier copy is retired, so a suspended tab
            // does not leave a day of stale notifications on screen.
            expect(instances).toHaveLength(2);
            expect(instances[0]?.close).toHaveBeenCalledTimes(1);
        });

        it('keeps a single timer per entity when the same reminder is set twice', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0));
            const { instances } = installMockNotification();

            await NotificationService.scheduleWebNotification(3, 'First', 'Body', new Date(2026, 11, 1, 10, 5));
            await NotificationService.scheduleWebNotification(3, 'Second', 'Body', new Date(2026, 11, 1, 10, 10));
            await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

            expect(instances).toHaveLength(1);
            expect(instances[0]?.title).toBe('Second');
        });

        it('does not fire a far-future reminder early when the timeout has to be split', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
            const { instances } = installMockNotification();

            // 40 days out: longer than the largest delay `setTimeout` accepts,
            // so the timer has to wake early and re-arm itself.
            const result = await NotificationService.scheduleWebNotification(
                21,
                'Far',
                'Body',
                new Date(2026, 1, 10, 9, 0, 0),
            );
            expect(result.success).toBe(true);

            await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000);
            expect(instances).toHaveLength(0);

            await vi.advanceTimersByTimeAsync(11 * 24 * 60 * 60 * 1000);
            expect(instances).toHaveLength(1);
        });

        it('sounds the alarm tone when a web reminder fires', async () => {
            // A banner with no sound is a line of text, not an alarm. The tone is
            // the same `createAlarmAudio` controller `App` and `CountdownTimer`
            // use, so there is one gain value and one cross-origin handling for the
            // whole app - and the web path is reached only when the platform is not
            // native, so it can never sound at the same time as the app-level one.
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            installMockNotification();

            const result = await NotificationService.scheduleWebNotification(
                3,
                'Study Time',
                'Body',
                new Date(2026, 8, 25, 10, 5),
            );
            expect(result.reliableOnlyWhileOpen).toBe(true);
            expect(audioMocks.instances).toHaveLength(0);

            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

            expect(audioMocks.instances).toHaveLength(1);
            expect(audioMocks.instances[0]?.play).toHaveBeenCalledTimes(1);
        });

        it('raises the page and closes the banner when a web reminder is clicked', async () => {
            // Without this the delivered reminder was inert: the banner appeared
            // and clicking it did nothing at all. The contract stays "reliable
            // only while the app is open" - that is all a `setTimeout` can promise
            // - but a notification that *is* delivered can at least bring its own
            // page forward.
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            const focus = vi.fn();
            vi.stubGlobal('focus', focus);
            const { instances } = installMockNotification();

            await NotificationService.scheduleWebNotification(3, 'Study Time', 'Body', new Date(2026, 8, 25, 10, 5));
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

            const delivered = instances.at(-1);
            expect(delivered?.onclick).toBeTypeOf('function');
            delivered?.onclick?.();

            expect(focus).toHaveBeenCalledTimes(1);
            expect(delivered?.close).toHaveBeenCalledTimes(1);
        });

        it('stops the tone when the reminder it belongs to is cancelled', async () => {
            // A cancelled reminder must not keep a looping tone - and a
            // `MediaElementSource` for a ~1.4 MiB asset - alive until the page
            // unloads. The graph is disposed, not just paused, so the next arming
            // starts from a clean one.
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            installMockNotification();

            await NotificationService.scheduleWebNotification(3, 'Study Time', 'Body', new Date(2026, 8, 25, 10, 5));
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
            expect(audioMocks.instances).toHaveLength(1);

            await NotificationService.cancelNotification(3, 'subject');

            expect(audioMocks.instances[0]?.dispose).toHaveBeenCalledTimes(1);
        });

        it('replaces the tone on each occurrence of a repeating reminder', async () => {
            // Otherwise a daily reminder accumulates one live audio graph per day
            // for as long as the tab stays open.
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            installMockNotification();

            const result = await NotificationService.scheduleDailyNotification(
                3,
                'Study Time',
                'Body',
                10,
                5,
                'ALARM_ACTIONS',
                'subject',
            );
            expect(result.success).toBe(true);

            await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
            expect(audioMocks.instances).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
            expect(audioMocks.instances).toHaveLength(2);

            expect(audioMocks.instances[0]?.dispose).toHaveBeenCalledTimes(1);
            expect(audioMocks.instances[1]?.dispose).not.toHaveBeenCalled();
        });
    });

    describe('web one-shot semantics', () => {
        it('keeps a fired one-shot reminder closable by a later cancel', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            const { instances } = installMockNotification();

            const scheduled = await NotificationService.scheduleNotification(
                3,
                'Study Time',
                'Body',
                new Date(2026, 8, 25, 10, 5),
            );
            expect(scheduled.success).toBe(true);
            expect(scheduled.sessionOnly).toBe(true);

            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
            await NotificationService.cancelNotification(3, 'subject');

            expect(instances[0]?.close).toHaveBeenCalledTimes(1);
        });

        it('refuses a one-shot whose moment has passed instead of firing it at once', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            const { instances } = installMockNotification();

            const result = await NotificationService.scheduleWebNotification(
                3,
                'Study Time',
                'Body',
                new Date(2026, 8, 25, 9, 59),
            );
            // `setTimeout` clamps a negative delay to zero, so accepting it would
            // show the reminder immediately and report that it is set.
            expect(result).toEqual({ success: false, error: 'Notification time must be in the future' });

            await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
            expect(instances).toHaveLength(0);
        });

        it('leaves an armed reminder alone when a later attempt is refused', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            const { instances } = installMockNotification();

            await NotificationService.scheduleWebNotification(3, 'Study Time', 'Body', new Date(2026, 8, 25, 10, 5));
            const refused = await NotificationService.scheduleWebNotification(
                3,
                'Study Time',
                'Body',
                new Date(2026, 8, 25, 9, 0),
            );
            expect(refused.success).toBe(false);

            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
            expect(instances).toHaveLength(1);
            expect(instances[0]?.title).toBe('Study Time');
        });

        it('accepts an epoch timestamp instead of failing a daily range check', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            installMockNotification();

            const result = await NotificationService.scheduleWebNotification(4, 'Todo', 'Body', Date.now() + 60_000);
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('rejects an unparsable web reminder date', async () => {
            installMockNotification();

            const result = await NotificationService.scheduleWebNotification(4, 'Todo', 'Body', Number.NaN);
            expect(result).toEqual({ success: false, error: 'Invalid notification date' });
        });

        it('reports a browser without Notification support instead of claiming success', async () => {
            vi.stubGlobal('Notification', undefined);
            const result = await NotificationService.scheduleWebNotification(
                4,
                'Todo',
                'Body',
                new Date(Date.now() + 60_000),
            );
            expect(result).toEqual({
                success: false,
                error: 'Web Notifications are only available in a supported browser',
            });
        });
    });

    describe('native lifecycle metadata', () => {
        it('cancels the delivered notification as well as the pending one', async () => {
            useAndroid();
            const expectedId = getNotificationId('todo', 9);

            await expect(NotificationService.cancelTodoNotification(9)).resolves.toBe(true);

            expect(mocks.notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: expectedId }] });
            expect(mocks.notifications.removeDeliveredNotificationsById).toHaveBeenCalledWith({ ids: [expectedId] });
        });

        it('still reports success when only the delivered cleanup is unavailable', async () => {
            useAndroid();
            mocks.notifications.removeDeliveredNotificationsById.mockRejectedValue(new Error('unsupported'));

            await expect(NotificationService.cancelSubjectNotification(3)).resolves.toBe(true);
        });

        it('answers the arming question only, not the shade', async () => {
            useAndroid();
            // The shell uses this answer to unset a subject's reminder, so it has
            // to mean "no longer armed". A copy still sitting on the shade is not
            // an armed alarm, and reporting the cancel as failed over it would
            // leave the UI claiming a reminder is still going to ring.
            mocks.notifications.removeDeliveredNotificationsById.mockRejectedValue(new Error('unsupported'));
            await expect(NotificationService.cancelSubjectNotification(3)).resolves.toBe(true);
            expect(mocks.notifications.cancel).toHaveBeenCalledWith({
                notifications: [{ id: getNotificationId('subject', 3) }],
            });
        });

        it('sweeps the shade in the per-id fallback too, not just the cancelAll branch', async () => {
            useAndroid();
            (mocks.notifications as Record<string, unknown>).removeAllDeliveredNotifications = vi
                .fn()
                .mockResolvedValue(undefined);
            mocks.notifications.getPending.mockResolvedValue({ notifications: [{ id: 11 }] });

            // The whole-shade clear is this operation's deliverable, and the
            // per-id path cannot reach a delivered notification whose record the
            // plugin no longer tracks. Without the sweep the two branches answer
            // the same question differently for the same leftover.
            await expect(NotificationService.cancelAllNotifications()).resolves.toBe(true);
            expect(mocks.notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 11 }] });
            expect(
                (mocks.notifications as Record<string, unknown>).removeAllDeliveredNotifications,
            ).toHaveBeenCalledTimes(1);
        });

        it('reports a failed shade sweep in the per-id fallback as well', async () => {
            useAndroid();
            (mocks.notifications as Record<string, unknown>).removeAllDeliveredNotifications = vi
                .fn()
                .mockRejectedValue(new Error('bridge down'));
            mocks.notifications.getPending.mockResolvedValue({ notifications: [{ id: 11 }] });

            await expect(NotificationService.cancelAllNotifications()).resolves.toBe(false);
        });

        it('tells a failed pending read apart from an empty one', async () => {
            useAndroid();
            // The whole point of the shape: an empty list says "nothing is
            // scheduled", so reporting a bridge failure as one tells the caller
            // every reminder is gone - and re-arming everything, or stopping
            // the warning, is the exact opposite of what a failure warrants.
            mocks.notifications.getPending.mockResolvedValue({ notifications: [] });
            await expect(NotificationService.getPending()).resolves.toEqual({ ok: true, notifications: [] });

            mocks.notifications.getPending.mockRejectedValue(new Error('bridge down'));
            await expect(NotificationService.getPending()).resolves.toEqual({
                ok: false,
                notifications: [],
                error: 'Unable to read the scheduled notifications on this device',
            });
        });

        it('passes the schedule through so a delivered record is tellable from an armed one', async () => {
            useAndroid();
            const schedule = { at: new Date(2099, 0, 1, 9, 0, 0), repeats: false };
            mocks.notifications.getPending.mockResolvedValue({
                notifications: [{ id: 31, title: 'T', body: 'B', extra: { type: 'todo', entityId: 7 }, schedule }],
            });

            const read = await NotificationService.getPending();
            expect(read.ok).toBe(true);
            expect(read.notifications[0]?.schedule).toBe(schedule);
        });

        it('reports a failed cancel instead of pretending the alarm is gone', async () => {
            useAndroid();
            mocks.notifications.cancel.mockRejectedValue(new Error('bridge down'));

            await expect(NotificationService.cancelSubjectNotification(3)).resolves.toBe(false);
            // The copy already on the shade is still worth clearing.
            expect(mocks.notifications.removeDeliveredNotificationsById).toHaveBeenCalledWith({
                ids: [getNotificationId('subject', 3)],
            });
        });

        it('cancels the reserved timer id and the hashed focus-alarm id', async () => {
            useAndroid();

            await NotificationService.cancelTimerNotifications();
            expect(mocks.notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: TIMER_NOTIFICATION_ID }] });

            mocks.notifications.cancel.mockClear();
            await NotificationService.cancelNotification('focus-7', 'focus-alarm');
            expect(mocks.notifications.cancel).toHaveBeenCalledWith({
                notifications: [{ id: getNotificationId('focus-alarm', 'focus-7') }],
            });
        });

        it('sweeps the whole shade with cancelAll and a delivered clear', async () => {
            useAndroid();
            (mocks.notifications as Record<string, unknown>).cancelAll = vi.fn().mockResolvedValue(undefined);
            (mocks.notifications as Record<string, unknown>).removeAllDeliveredNotifications = vi
                .fn()
                .mockResolvedValue(undefined);

            await expect(NotificationService.cancelAllNotifications()).resolves.toBe(true);
            // `getPending` only knows what the plugin still tracks, so a per-id
            // clear would leave a delivered notification behind.
            expect((mocks.notifications as Record<string, unknown>).cancelAll).toHaveBeenCalledTimes(1);
            expect(
                (mocks.notifications as Record<string, unknown>).removeAllDeliveredNotifications,
            ).toHaveBeenCalledTimes(1);
        });

        it('reports a failed shade sweep rather than claiming the alarms are gone', async () => {
            useAndroid();
            (mocks.notifications as Record<string, unknown>).cancelAll = vi.fn().mockResolvedValue(undefined);
            (mocks.notifications as Record<string, unknown>).removeAllDeliveredNotifications = vi
                .fn()
                .mockRejectedValue(new Error('bridge down'));

            await expect(NotificationService.cancelAllNotifications()).resolves.toBe(false);
        });

        it('falls back to per-id cancellation when cancelAll is unavailable', async () => {
            useAndroid();
            mocks.notifications.getPending.mockResolvedValue({ notifications: [{ id: 11 }, { id: 12 }] });

            await expect(NotificationService.cancelAllNotifications()).resolves.toBe(true);
            expect(mocks.notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 11 }, { id: 12 }] });
        });

        it('keeps a desired reminder when its scheduled target is on another date', async () => {
            useAndroid();
            mocks.notifications.getPending.mockResolvedValue({
                notifications: [
                    {
                        id: 77,
                        title: 'Reminder',
                        body: 'Body',
                        extra: {
                            type: 'subject',
                            entityId: 12,
                            originalId: 12,
                            date: '2099-01-01',
                        },
                    },
                ],
            });

            const result = await NotificationService.reconcileSubjectNotifications([
                {
                    id: 12,
                    title: 'Reminder',
                    body: 'Body',
                    date: new Date(Date.now() - 1000),
                },
            ]);

            expect(result.success).toBe(true);
            expect(mocks.notifications.cancel).not.toHaveBeenCalled();
        });

        it('uses shared icon, private visibility, sound, and entity metadata', async () => {
            useAndroid();
            const at = new Date(Date.now() + 60_000);
            const result = await NotificationService.scheduleSubjectNotification(12, 'Subject', 'Body', at);
            expect(result.success).toBe(true);
            expect(mocks.notifications.createChannel).not.toHaveBeenCalled();
            const notification = onlyScheduledNotification();
            expect(notification?.smallIcon).toBe(NOTIFICATION_ICON);
            expect(notification?.channelId).toBe(NOTIFICATION_CHANNEL_ID);
            expect(notification?.extra).toMatchObject({ type: 'subject', entityId: 12, originalId: 12 });
            expect(NOTIFICATION_SOUND).toBe('alarm_loop.mp3');
            expect(NOTIFICATION_VISIBILITY).toBe(0);
        });

        it('takes the sound from the one channel on Android instead of restating it', async () => {
            useAndroid();
            await NotificationService.scheduleSubjectNotification(12, 'Subject', 'Body', new Date(Date.now() + 60_000));

            // A per-notification sound is ignored in favour of the channel from
            // API 26, and below that the plugin would resolve it as a raw
            // resource name - `alarm_loop.mp3` is not the name of the resource.
            // Restating it here is how the two would drift apart.
            expect(onlyScheduledNotification()?.sound).toBeUndefined();
            expect(mocks.notifications.createChannel).not.toHaveBeenCalled();
        });

        it('arms a sound on a platform with no channel to carry it', async () => {
            mocks.native = true;
            mocks.platform = 'ios';
            armAndroidPermissions();

            const result = await NotificationService.scheduleSubjectNotification(
                12,
                'Subject',
                'Body',
                new Date(Date.now() + 60_000),
            );

            expect(result.success).toBe(true);
            // The plugin documents that a notification with no `sound` produces
            // *no sound at all* on iOS. Without this the alarm is armed, is
            // reported as armed, and is completely mute.
            expect(onlyScheduledNotification()?.sound).toBe(NOTIFICATION_SOUND);
        });

        it('rejects a date that is not an instant instead of throwing at the bridge', async () => {
            useAndroid();
            // `at.getTime()` on a non-Date throws, and a schedule that rejects
            // on a caller's bad argument is reported by the shell as an
            // unexplained "unable to schedule" rather than as the bad date.
            await expect(
                NotificationService.scheduleNotification(12, 'Subject', 'Body', 'not-a-date' as unknown as Date),
            ).resolves.toEqual({ success: false, error: 'Invalid notification date' });
            expect(mocks.notifications.schedule).not.toHaveBeenCalled();
        });

        it('accepts an epoch or ISO instant where a Date is expected', async () => {
            useAndroid();
            const at = Date.now() + 60_000;

            await expect(NotificationService.scheduleNotification(12, 'Subject', 'Body', at)).resolves.toEqual({
                success: true,
            });
            const schedule = onlyScheduledNotification()?.schedule as { at: Date };
            expect(schedule.at.getTime()).toBe(at);

            mocks.notifications.schedule.mockClear();
            await expect(
                NotificationService.scheduleNotification(12, 'Subject', 'Body', new Date(at).toISOString()),
            ).resolves.toEqual({ success: true });
        });

        it('leaves subject reminders dismissible and makes the focus timer an ongoing exact alarm', async () => {
            useAndroid();

            await NotificationService.scheduleSubjectNotification(5, 'Accounts', 'Body', new Date(Date.now() + 60_000));
            const subject = onlyScheduledNotification();
            expect(subject?.ongoing).toBe(false);
            expect(subject?.autoCancel).toBe(true);
            expect(subject?.isExactMandatory).toBe(false);
            expect(subject?.isExactNotification).toBe(true);

            mocks.notifications.schedule.mockClear();
            await NotificationService.scheduleNotification(
                TIMER_NOTIFICATION_ID,
                "Time's Up!",
                'Your focus session is complete.',
                new Date(Date.now() + 60_000),
                'ALARM_ACTIONS',
                'timer',
            );
            const timer = onlyScheduledNotification();
            expect(timer?.id).toBe(TIMER_NOTIFICATION_ID);
            expect(timer?.ongoing).toBe(true);
            expect(timer?.isExactMandatory).toBe(true);
        });

        it('records the entity type, id and the alarm date for every entity type', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
            useAndroid();

            await NotificationService.scheduleSubjectNotification(12, 'Subject', 'Body', new Date(2026, 8, 25, 14, 30));
            await NotificationService.scheduleTodoNotification(7, 'Todo', 'Body', 15, 45);
            await NotificationService.scheduleNotification(
                'focus-1',
                'Focus',
                'Body',
                new Date(2026, 8, 25, 16, 0),
                'ALARM_ACTIONS',
                'focus-alarm',
            );
            await NotificationService.scheduleNotification(
                TIMER_NOTIFICATION_ID,
                'Timer',
                'Body',
                new Date(2026, 8, 25, 17, 0),
                'ALARM_ACTIONS',
                'timer',
            );

            expect(scheduledNotifications().map((notification) => notification.extra)).toEqual([
                { type: 'subject', entityId: 12, date: '2026-09-25', originalId: 12 },
                { type: 'todo', entityId: 7, date: '2026-09-25', originalId: 7 },
                { type: 'focus-alarm', entityId: 'focus-1', date: '2026-09-25', originalId: 'focus-1' },
                {
                    type: 'timer',
                    entityId: TIMER_NOTIFICATION_ID,
                    date: '2026-09-25',
                    originalId: TIMER_NOTIFICATION_ID,
                },
            ]);
            // Each entity type owns a separate id space, so two entities never
            // fight over one alarm slot.
            const ids = scheduledNotifications().map((notification) => notification.id);
            expect(new Set(ids).size).toBe(ids.length);
            expect(ids[2]).toBe(getNotificationId('focus-alarm', 'focus-1'));
        });

        it('arms subject and todo reminders as one absolute alarm, never a daily series', async () => {
            useAndroid();

            await NotificationService.scheduleSubjectNotification(12, 'Subject', 'Body', new Date(Date.now() + 60_000));
            await NotificationService.scheduleTodoNotification(7, 'Todo', 'Body', 23, 30);

            for (const notification of scheduledNotifications()) {
                const schedule = notification.schedule as { at: Date; repeats: boolean; on?: unknown; every?: unknown };
                expect(schedule.at).toBeInstanceOf(Date);
                expect(schedule.at.getTime()).toBeGreaterThan(Date.now());
                // Capacitor 8 turns `repeats: true` into a repeating alarm over
                // the gap until the first occurrence, and a `{ hour, minute }`
                // match rolls forward by an hour, so a daily reminder is armed as
                // a single alarm and re-armed by the reconcile pass instead.
                expect(schedule.repeats).toBe(false);
                expect(schedule.on).toBeUndefined();
                expect(schedule.every).toBeUndefined();
            }
        });

        it('refuses a reminder whose time has already passed', async () => {
            useAndroid();
            const past = await NotificationService.scheduleSubjectNotification(
                12,
                'Subject',
                'Body',
                new Date(Date.now() - 1000),
            );
            expect(past).toEqual({ success: false, error: 'Notification time must be in the future' });
            expect(mocks.notifications.schedule).not.toHaveBeenCalled();
        });

        it('refuses an unparsable date without reaching the bridge', async () => {
            useAndroid();
            const invalid = await NotificationService.scheduleSubjectNotification(
                12,
                'Subject',
                'Body',
                new Date(Number.NaN),
            );
            expect(invalid).toEqual({ success: false, error: 'Invalid notification date' });
            expect(mocks.notifications.schedule).not.toHaveBeenCalled();
        });

        it('reports a failure when the device resolves without arming the alarm', async () => {
            useAndroid();
            // A resolved call that lists no id means nothing was registered;
            // reporting success would leave the UI promising a reminder that
            // does not exist.
            mocks.notifications.schedule.mockResolvedValue({ notifications: [] });
            expect(
                await NotificationService.scheduleSubjectNotification(
                    12,
                    'Subject',
                    'Body',
                    new Date(Date.now() + 60_000),
                ),
            ).toEqual({ success: false, error: 'The device accepted the alarm without arming it' });

            mocks.notifications.schedule.mockResolvedValue({ notifications: [{ id: 999 }] });
            expect(
                await NotificationService.scheduleSubjectNotification(
                    12,
                    'Subject',
                    'Body',
                    new Date(Date.now() + 60_000),
                ),
            ).toEqual({ success: false, error: 'The device accepted the alarm without arming it' });
        });

        it('accepts a result that does not report a list at all', async () => {
            useAndroid();
            // A shape this service cannot second-guess must not be turned into a
            // spurious failure.
            mocks.notifications.schedule.mockResolvedValue({});
            await expect(
                NotificationService.scheduleSubjectNotification(12, 'Subject', 'Body', new Date(Date.now() + 60_000)),
            ).resolves.toEqual({ success: true });
        });

        it('keeps an inexact downgrade visible instead of flattening it into a success', async () => {
            useAndroid();
            mocks.notifications.schedule.mockImplementation(
                async ({ notifications }: { notifications: Array<{ id: number }> }) => ({
                    notifications: notifications.map((notification) => ({ id: notification.id })),
                    warning: { code: 'OS-PLUG-LNOT-0001', message: 'Scheduled without exact alarm permission' },
                }),
            );

            const result = await NotificationService.scheduleSubjectNotification(
                12,
                'Subject',
                'Body',
                new Date(Date.now() + 60_000),
            );
            expect(result).toEqual({
                success: true,
                inexact: true,
                warning: 'Scheduled without exact alarm permission',
            });
        });

        it('surfaces a bridge rejection as a failure', async () => {
            useAndroid();
            mocks.notifications.schedule.mockRejectedValue(new Error('notifications are disabled'));
            const result = await NotificationService.scheduleSubjectNotification(
                12,
                'Subject',
                'Body',
                new Date(Date.now() + 60_000),
            );
            expect(result).toEqual({ success: false, error: 'notifications are disabled' });
        });
    });

    describe('reconcile', () => {
        it('is idempotent: a second pass re-arms the same ids and cancels nothing', async () => {
            useAndroid();
            // The plugin keys its own store by id, so the pending list reflects
            // whatever was armed rather than growing a duplicate per pass.
            mocks.notifications.getPending.mockImplementation(async () => ({
                notifications: scheduledNotifications().map((notification) => ({
                    id: notification.id,
                    extra: notification.extra,
                })),
            }));
            const definitions = [{ id: 12, title: 'Reminder', body: 'Body', date: new Date(Date.now() + 3_600_000) }];

            await expect(NotificationService.reconcileSubjectNotifications(definitions)).resolves.toEqual({
                success: true,
            });
            expect(mocks.notifications.cancel).not.toHaveBeenCalled();
            expect(scheduledNotifications()).toHaveLength(1);

            await expect(NotificationService.reconcileSubjectNotifications(definitions)).resolves.toEqual({
                success: true,
            });
            expect(mocks.notifications.cancel).not.toHaveBeenCalled();

            const ids = scheduledNotifications().map((notification) => notification.id);
            expect(ids).toHaveLength(2);
            expect(new Set(ids).size).toBe(1);
        });

        it('cancels a stale reminder of the same type and leaves other types alone', async () => {
            useAndroid();
            mocks.notifications.getPending.mockResolvedValue({
                notifications: [
                    { id: 501, extra: { type: 'subject', entityId: 99, date: '2026-09-25', originalId: 99 } },
                    { id: 502, extra: { type: 'todo', entityId: 7, date: '2026-09-25', originalId: 7 } },
                    {
                        id: TIMER_NOTIFICATION_ID,
                        extra: { type: 'timer', entityId: 101, date: '2026-09-25', originalId: 101 },
                    },
                ],
            });

            const result = await NotificationService.reconcileSubjectNotifications([
                { id: 12, title: 'Reminder', body: 'Body', date: new Date(Date.now() + 3_600_000) },
            ]);

            expect(result.success).toBe(true);
            // Only the subject reminder the user no longer wants. A daily todo and
            // a running countdown timer are armed by other passes.
            expect(mocks.notifications.cancel).toHaveBeenCalledTimes(1);
            expect(mocks.notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 501 }] });
        });

        it('drops a record of this type whose metadata no longer parses', async () => {
            useAndroid();
            mocks.notifications.getPending.mockResolvedValue({
                notifications: [
                    { id: 601, extra: { type: 'subject' } },
                    { id: 602, extra: { type: 'subject', entityId: 12, date: 'not-a-date' } },
                    { id: 603, extra: { type: 'something-else', entityId: 1 } },
                ],
            });

            const result = await NotificationService.reconcileSubjectNotifications([]);
            expect(result.success).toBe(true);
            // The unparseable records of this type cannot be matched against the
            // desired set, so they are dropped rather than stranded; the record
            // owned by another subsystem is left untouched.
            expect(mocks.notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 601 }, { id: 602 }] });
        });

        it('fails the pass when the pending list cannot be read', async () => {
            useAndroid();
            mocks.notifications.getPending.mockRejectedValue(new Error('bridge down'));

            const result = await NotificationService.reconcileSubjectNotifications([
                { id: 12, title: 'Reminder', body: 'Body', date: new Date(Date.now() + 3_600_000) },
            ]);

            // Without the pending list the pass cannot tell a stale alarm from a
            // current one, so it must not claim to have reconciled.
            expect(result).toEqual({
                success: false,
                error: 'Unable to read the scheduled notifications on this device',
            });
            // The desired alarm is armed anyway: re-arming is keyed by id and
            // replaces whatever was there, and skipping it would silently drop a
            // reminder the user is relying on. The failure is still reported, so
            // nothing claims the schedule was fully reconciled.
            expect(scheduledNotifications().map((notification) => notification.extra)).toEqual([
                { type: 'subject', entityId: 12, date: localDateKey(new Date()), originalId: 12 },
            ]);
        });

        it('treats a pass for another day as a no-op rather than a completed reconcile', async () => {
            useAndroid();
            const result = await NotificationService.reconcileSubjectNotifications(
                [{ id: 12, title: 'Reminder', body: 'Body', date: new Date(Date.now() + 3_600_000) }],
                '2099-01-01',
            );

            // A subject reminder belongs to one day, so a pass for any other day
            // must not disturb the alarms of the day that is armed. `skipped` is
            // what says so: `{ success: true }` on its own is the same answer a
            // pass that armed everything gives.
            expect(result).toEqual({ success: true, skipped: true });
            expect(mocks.notifications.getPending).not.toHaveBeenCalled();
            expect(mocks.notifications.schedule).not.toHaveBeenCalled();
            expect(mocks.notifications.cancel).not.toHaveBeenCalled();
        });

        it('does not let a skipped half of the pass read as a completed reconcile', async () => {
            useAndroid();
            const result = await NotificationService.reconcileNotifications(
                [{ id: 12, title: 'Reminder', body: 'Body', date: new Date(Date.now() + 3_600_000) }],
                [{ id: 7, title: 'Todo', body: 'Body', hour: 23, minute: 59 }],
                '2099-01-01',
            );

            // The todo half really did arm, the subject half deliberately did
            // not. Aggregating them into a bare `{ success: true }` is how a
            // caller would come to believe every subject reminder is reconciled
            // when not one of them was touched.
            expect(result).toEqual({ success: true, skipped: true });
        });

        it('keeps a fully reconciled pass free of the skipped flag', async () => {
            useAndroid();
            // The flag has to mean something: a pass that armed everything must
            // not look like one that deliberately did nothing.
            await expect(
                NotificationService.reconcileNotifications(
                    [{ id: 12, title: 'Reminder', body: 'Body', date: new Date(Date.now() + 3_600_000) }],
                    [{ id: 7, title: 'Todo', body: 'Body', hour: 23, minute: 59 }],
                ),
            ).resolves.toEqual({ success: true });
        });

        it('prefers a real failure over the skipped flag', async () => {
            useAndroid();
            // Otherwise the flag would mask the one thing the caller must act on.
            mocks.notifications.getPending.mockRejectedValue(new Error('bridge down'));
            const result = await NotificationService.reconcileNotifications(
                [{ id: 12, title: 'Reminder', body: 'Body', date: new Date(Date.now() + 3_600_000) }],
                [{ id: 7, title: 'Todo', body: 'Body', hour: 9, minute: 0 }],
                '2099-01-01',
            );

            expect(result).toEqual({
                success: false,
                error: 'Unable to read the scheduled notifications on this device',
            });
        });

        it('keeps daily reminders armed whatever day is selected', async () => {
            useAndroid();
            await NotificationService.reconcileNotifications(
                [{ id: 12, title: 'Reminder', body: 'Body', date: new Date(Date.now() + 3_600_000) }],
                [{ id: 7, title: 'Todo', body: 'Body', hour: 23, minute: 59 }],
                '2099-01-01',
            );

            // A todo reminder is a wall-clock time rather than an instant on a
            // day, so unlike the subject pass it is re-armed regardless. The
            // recorded date is the occurrence that was armed, which is tomorrow's
            // date whenever today's time has already passed.
            expect(scheduledNotifications().map((notification) => notification.extra)).toEqual([
                { type: 'todo', entityId: 7, date: localDateKey(getNextDailyReminderDate(23, 59)), originalId: 7 },
            ]);
        });

        it('reports a corrupt definition date without taking the rest of the pass down', async () => {
            useAndroid();
            const result = await NotificationService.reconcileNotifications(
                [{ id: 12, title: 'Reminder', body: 'Body', date: 'not-a-date' }],
                [{ id: 7, title: 'Todo', body: 'Body', hour: 9, minute: 0 }],
            );

            expect(result).toEqual({ success: false, error: 'Invalid notification date' });
            // The todo pass still ran: one bad entry must not silence the others.
            expect(scheduledNotifications().map((notification) => notification.extra)).toEqual([
                { type: 'todo', entityId: 7, date: localDateKey(getNextDailyReminderDate(9, 0)), originalId: 7 },
            ]);
        });

        it('fails only the reminder with an impossible clock time', async () => {
            useAndroid();
            const result = await NotificationService.reconcileTodoNotifications([
                { id: 7, title: 'Todo', body: 'Body', hour: 99, minute: 0 },
                { id: 8, title: 'Todo', body: 'Body', hour: 9, minute: 30 },
            ]);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Hour must be an integer from 0 to 23');
            expect(scheduledNotifications().map((notification) => notification.extra)).toEqual([
                { type: 'todo', entityId: 8, date: localDateKey(getNextDailyReminderDate(9, 30)), originalId: 8 },
            ]);
        });

        it('keeps an inexact downgrade visible through the aggregate', async () => {
            useAndroid();
            mocks.notifications.schedule.mockImplementation(
                async ({ notifications }: { notifications: Array<{ id: number }> }) => ({
                    notifications: notifications.map((notification) => ({ id: notification.id })),
                    warning: { code: 'OS-PLUG-LNOT-0001', message: 'Scheduled without exact alarm permission' },
                }),
            );

            const result = await NotificationService.reconcileSubjectNotifications([
                { id: 12, title: 'Reminder', body: 'Body', date: new Date(Date.now() + 3_600_000) },
            ]);
            expect(result).toEqual({
                success: true,
                inexact: true,
                warning: 'Scheduled without exact alarm permission',
            });
        });

        it('drops stale web reminders and arms only the desired set', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0));
            const { instances, requestPermission } = installMockNotification();

            await NotificationService.scheduleSubjectNotification(99, 'Old', 'Body', new Date(2026, 11, 1, 11, 0));
            await NotificationService.scheduleTodoNotification(7, 'Todo', 'Body', 12, 0);

            await NotificationService.reconcileSubjectNotifications([
                { id: 12, title: 'New', body: 'Body', date: new Date(2026, 11, 1, 11, 0) },
            ]);
            await NotificationService.reconcileTodoNotifications([
                { id: 7, title: 'Todo', body: 'Body', hour: 13, minute: 0 },
            ]);

            await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
            // Only the reconciled subject reminder and the re-timed daily todo.
            expect(instances.map((instance) => instance.title)).toEqual(['New', 'Todo']);
            // A reconcile arms what is already known to be deliverable; it never
            // pops the permission dialog.
            expect(requestPermission).not.toHaveBeenCalled();
        });

        it('refuses to arm a web reminder whose permission is still unanswered, without prompting', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0));
            // The user would grant it if asked, but a reconcile must never be the
            // thing that pops the permission dialog.
            const { instances, requestPermission } = installMockNotification('default', 'granted');

            const result = await NotificationService.reconcileSubjectNotifications([
                { id: 12, title: 'Reminder', body: 'Body', date: new Date(2026, 11, 1, 11, 0) },
            ]);
            // Not "denied": nobody has been asked, and calling that a denial
            // blames the user for a choice they were never offered.
            expect(result).toEqual({
                success: false,
                error: 'Notification permission has not been granted yet',
            });
            expect(requestPermission).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
            expect(instances).toHaveLength(0);
        });

        it('keeps a working web reminder when the pass meant to move it fails', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0));
            const { instances } = installMockNotification();

            await NotificationService.scheduleTodoNotification(7, 'Todo', 'Body', 12, 0);
            // The permission is revoked between the arm and the reconcile, which
            // is what makes the re-arm fail.
            const api = (window as unknown as { Notification: { permission: string } }).Notification;
            api.permission = 'denied';

            const result = await NotificationService.reconcileTodoNotifications([
                { id: 7, title: 'Todo', body: 'Body', hour: 13, minute: 0 },
            ]);
            expect(result.success).toBe(false);

            await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
            // Sweeping the leftovers *before* arming - as this path used to - threw
            // the 12:00 reminder away and left the user with none at all, where
            // the native path only ever cancels ids the desired set lacks.
            expect(instances.map((instance) => instance.title)).toEqual(['Todo']);
        });

        it('still drops the web reminders the pass no longer wants', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0));
            const { instances } = installMockNotification();

            await NotificationService.scheduleTodoNotification(7, 'Old', 'Body', 12, 0);
            await NotificationService.reconcileTodoNotifications([
                { id: 8, title: 'New', body: 'Body', hour: 13, minute: 0 },
            ]);

            await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
            expect(instances.map((instance) => instance.title)).toEqual(['New']);
        });

        it('keeps a fired subject reminder closable when its date has passed', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0));
            const { instances } = installMockNotification();

            await NotificationService.scheduleWebNotification(3, 'Study', 'Body', new Date(2026, 11, 1, 10, 5));
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
            expect(instances).toHaveLength(1);

            // The occurrence is in the past, so nothing is re-armed - but the
            // entity is still wanted, so the handle survives and a later cancel
            // can take the notification off the screen.
            await NotificationService.reconcileSubjectNotifications([
                { id: 3, title: 'Study', body: 'Body', date: new Date(2026, 11, 1, 10, 5) },
            ]);
            expect(instances[0]?.close).not.toHaveBeenCalled();

            await NotificationService.cancelSubjectNotification(3);
            expect(instances[0]?.close).toHaveBeenCalledTimes(1);
        });
    });

    describe('action listeners', () => {
        /** What the plugin hands a listener: a received notification, or an action carrying one. */
        interface ListenerPayload {
            actionId?: string;
            id?: number;
            extra?: Record<string, unknown>;
            actionTypeId?: string;
            notification?: ListenerPayload;
        }

        const captureListeners = async () => {
            const registered: Partial<Record<string, (payload: ListenerPayload) => Promise<void> | void>> = {};
            mocks.notifications.addListener.mockImplementation(
                async (name: string, callback: (payload: ListenerPayload) => Promise<void>) => {
                    registered[name] = callback;
                    return { remove: vi.fn().mockResolvedValue(undefined) };
                },
            );
            const onAction = vi.fn();
            const onReceive = vi.fn();
            await NotificationService.initListeners(onAction, onReceive);
            const listener = (name: string) => {
                const callback = registered[name];
                if (!callback) {
                    throw new Error(`${name} was never registered`);
                }
                return callback;
            };
            return { listener, onAction, onReceive };
        };

        it('registers both listeners once and removes them on request', async () => {
            useAndroid();
            const removeFirst = vi.fn().mockResolvedValue(undefined);
            const removeSecond = vi.fn().mockResolvedValue(undefined);
            mocks.notifications.addListener
                .mockResolvedValueOnce({ remove: removeFirst })
                .mockResolvedValueOnce({ remove: removeSecond });

            await NotificationService.initListeners(vi.fn(), vi.fn());
            expect(mocks.notifications.removeAllListeners).toHaveBeenCalledTimes(1);
            expect(mocks.notifications.addListener.mock.calls.map((call) => call[0])).toEqual([
                'localNotificationReceived',
                'localNotificationActionPerformed',
            ]);

            await NotificationService.removeListeners();
            expect(removeFirst).toHaveBeenCalledTimes(1);
            expect(removeSecond).toHaveBeenCalledTimes(1);
        });

        it('removes the listeners a superseded init created instead of leaking them', async () => {
            useAndroid();
            const orphaned = { remove: vi.fn().mockResolvedValue(undefined) };
            const kept: Array<{ remove: ReturnType<typeof vi.fn> }> = [];
            let releaseOrphan!: (handle: unknown) => void;
            let signalOrphanReached!: () => void;
            const orphanReached = new Promise<void>((resolve) => {
                signalOrphanReached = resolve;
            });
            let call = 0;
            mocks.notifications.addListener.mockImplementation(() => {
                call += 1;
                if (call === 1) {
                    // Park the first init inside its first registration so the
                    // second one supersedes it mid-flight, which is the window in
                    // which a handle can be created and then abandoned.
                    signalOrphanReached();
                    return new Promise((resolve) => {
                        releaseOrphan = resolve;
                    });
                }
                const handle = { remove: vi.fn().mockResolvedValue(undefined) };
                kept.push(handle);
                return Promise.resolve(handle);
            });

            const first = NotificationService.initListeners(vi.fn(), vi.fn());
            await orphanReached;
            const second = NotificationService.initListeners(vi.fn(), vi.fn());
            await second;
            releaseOrphan(orphaned);
            await first;

            expect(orphaned.remove).toHaveBeenCalledTimes(1);
            expect(kept).toHaveLength(2);

            await NotificationService.removeListeners();
            for (const handle of kept) {
                expect(handle.remove).toHaveBeenCalledTimes(1);
            }
        });

        it('discards the listeners it created when a later registration fails', async () => {
            useAndroid();
            const removeFirst = vi.fn().mockResolvedValue(undefined);
            mocks.notifications.addListener
                .mockResolvedValueOnce({ remove: removeFirst })
                .mockRejectedValueOnce(new Error('bridge down'));

            await expect(NotificationService.initListeners(vi.fn(), vi.fn())).rejects.toThrow('bridge down');
            expect(removeFirst).toHaveBeenCalledTimes(1);
        });

        it('releases the handles a re-init replaces instead of overwriting them', async () => {
            useAndroid();
            const first = [
                { remove: vi.fn().mockResolvedValue(undefined) },
                { remove: vi.fn().mockResolvedValue(undefined) },
            ];
            mocks.notifications.addListener
                .mockResolvedValueOnce(first[0])
                .mockResolvedValueOnce(first[1])
                .mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });

            await NotificationService.initListeners(vi.fn(), vi.fn());
            await NotificationService.initListeners(vi.fn(), vi.fn());

            // `removeAllListeners` already unregistered these plugin-side, but the
            // handle *objects* are this service's only reference to those
            // registrations. Overwriting the array dropped them on the floor and
            // left them alive for the life of the page.
            expect(first[0]?.remove).toHaveBeenCalledTimes(1);
            expect(first[1]?.remove).toHaveBeenCalledTimes(1);

            await NotificationService.removeListeners();
            // And the second init's pair is still owned by this service, so the
            // teardown releases exactly those - no double removal.
            for (const handle of first) {
                expect(handle.remove).toHaveBeenCalledTimes(1);
            }
        });

        it('registers nothing in a browser, where no notification goes through the plugin', async () => {
            // The web path builds its own `Notification` objects, so neither
            // plugin event can ever describe one of them. Registering anyway
            // attached two listeners nothing in this service can reach.
            await expect(NotificationService.initListeners(vi.fn(), vi.fn())).resolves.toBeUndefined();
            expect(mocks.notifications.removeAllListeners).not.toHaveBeenCalled();
            expect(mocks.notifications.addListener).not.toHaveBeenCalled();
        });

        it('does not let a slow cancel delay the tap that stops the alarm', async () => {
            useAndroid();
            const { listener, onAction } = await captureListeners();
            // A device that is slow to answer a cancel is exactly the case the
            // old ordering made the user sit through: nothing was reported until
            // the bridge replied, so the alarm kept ringing for a round trip
            // after the user had already dismissed it.
            let releaseCancel!: () => void;
            mocks.notifications.cancel.mockImplementation(
                () =>
                    new Promise<void>((resolve) => {
                        releaseCancel = resolve;
                    }),
            );

            listener('localNotificationActionPerformed')({
                actionId: 'mark-done',
                notification: {
                    id: getNotificationId('todo', 7),
                    extra: { type: 'todo', entityId: 7, date: '2026-09-25', originalId: 7 },
                    actionTypeId: 'TODO_ACTIONS',
                },
            });

            // Reported with the cancel still in flight, not after it resolves.
            expect(onAction).toHaveBeenCalledTimes(1);
            expect(onAction).toHaveBeenCalledWith(
                expect.objectContaining({ originalId: 7, type: 'todo', entityId: 7 }),
            );

            releaseCancel();
            await vi.waitFor(() => expect(mocks.notifications.cancel).toHaveBeenCalled());
        });

        it('absorbs a failed auto-cancel instead of rejecting into the bridge', async () => {
            useAndroid();
            const { listener, onAction } = await captureListeners();
            // The plugin does not await what a listener returns, so a rejected
            // promise escaping one surfaces as an unhandled rejection - and under
            // the old ordering it took the tap with it.
            mocks.notifications.cancel.mockRejectedValue(new Error('bridge down'));

            const returned = listener('localNotificationActionPerformed')({
                actionId: 'mark-done',
                notification: {
                    id: getNotificationId('todo', 7),
                    extra: { type: 'todo', entityId: 7, date: '2026-09-25', originalId: 7 },
                    actionTypeId: 'TODO_ACTIONS',
                },
            });

            expect(returned).toBeUndefined();
            expect(onAction).toHaveBeenCalledTimes(1);
            // Let the rejected cancel settle: nothing is left dangling.
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(onAction).toHaveBeenCalledTimes(1);
        });

        it('reports the entity a record names even without the round-tripped alias', async () => {
            useAndroid();
            const { listener, onAction } = await captureListeners();

            await listener('localNotificationActionPerformed')({
                actionId: 'mark-done',
                notification: {
                    id: getNotificationId('todo', 7),
                    extra: { type: 'todo', entityId: 7, date: '2026-09-25' },
                    actionTypeId: 'TODO_ACTIONS',
                },
            });

            // The listeners used to read `extra.originalId` only, so a record
            // that names its entity without the alias was reported under the
            // *notification* id - which the shell compares against an entity id,
            // fails to match, and silently ignores while the tap still looks
            // handled.
            expect(onAction).toHaveBeenCalledWith({
                originalId: 7,
                actionId: 'mark-done',
                actionType: 'TODO_ACTIONS',
                type: 'todo',
                entityId: 7,
            });
        });

        it('keeps reporting a real id from a record too malformed to parse', async () => {
            useAndroid();
            const { listener, onReceive } = await captureListeners();

            await listener('localNotificationReceived')({
                id: 42,
                extra: { type: 'todo', entityId: 7, date: 'not-a-date' },
                actionTypeId: 'TODO_ACTIONS',
            });

            // The date is unusable, so the type cannot be trusted - but the
            // entity id is a real id, and dropping it would report the
            // notification id instead, which the shell compares against an
            // entity id and silently fails to match.
            expect(onReceive).toHaveBeenCalledWith({
                originalId: 7,
                actionType: 'TODO_ACTIONS',
                type: null,
                entityId: 7,
            });
        });

        it('never auto-cancels from a record whose metadata is unusable', async () => {
            useAndroid();
            const { listener } = await captureListeners();

            await listener('localNotificationActionPerformed')({
                actionId: 'mark-done',
                notification: {
                    // A stranger's id, and a record that names no entity.
                    id: 777,
                    extra: { type: 'todo', entityId: 7, date: 'not-a-date' },
                    actionTypeId: 'TODO_ACTIONS',
                },
            });

            // `entityId` resolves to 7 here, so the only thing standing between
            // this and a cancelled stranger's alarm is that the *metadata* has to
            // parse before a destructive auto-cancel runs.
            expect(mocks.notifications.cancel).not.toHaveBeenCalled();
        });

        it('cancels the pending daily alarm behind a todo action and reports the tap', async () => {
            useAndroid();
            const { listener, onAction, onReceive } = await captureListeners();

            await listener('localNotificationActionPerformed')({
                actionId: 'mark-done',
                notification: {
                    id: getNotificationId('todo', 7),
                    extra: { type: 'todo', entityId: 7, date: '2026-09-25', originalId: 7 },
                    actionTypeId: 'TODO_ACTIONS',
                },
            });

            expect(mocks.notifications.cancel).toHaveBeenCalledWith({
                notifications: [{ id: getNotificationId('todo', 7) }],
            });
            expect(onAction).toHaveBeenCalledWith({
                originalId: 7,
                actionId: 'mark-done',
                actionType: 'TODO_ACTIONS',
                type: 'todo',
                entityId: 7,
            });
            expect(onReceive).not.toHaveBeenCalled();
        });

        it('leaves a subject alarm armed when its dismiss action is performed', async () => {
            useAndroid();
            const { listener, onAction } = await captureListeners();

            await listener('localNotificationActionPerformed')({
                actionId: 'dismiss',
                notification: {
                    id: getNotificationId('subject', 12),
                    extra: { type: 'subject', entityId: 12, date: '2026-09-25', originalId: 12 },
                    actionTypeId: 'ALARM_ACTIONS',
                },
            });

            expect(mocks.notifications.cancel).not.toHaveBeenCalled();
            expect(onAction).toHaveBeenCalledWith({
                originalId: 12,
                actionId: 'dismiss',
                actionType: 'ALARM_ACTIONS',
                type: 'subject',
                entityId: 12,
            });
        });

        it('still reports a tap whose metadata is missing, and cancels nobody', async () => {
            useAndroid();
            const { listener, onAction } = await captureListeners();

            await listener('localNotificationActionPerformed')({
                actionId: 'tap',
                notification: { id: 777, actionTypeId: 'TODO_ACTIONS' },
            });
            await listener('localNotificationActionPerformed')({
                actionId: 'tap',
                notification: {
                    id: 778,
                    extra: { type: 'todo', originalId: null } as unknown as Record<string, unknown>,
                    actionTypeId: 'TODO_ACTIONS',
                },
            });

            // The entity behind the notification is unknown, and hashing the
            // notification id would cancel whichever alarm owns it.
            expect(mocks.notifications.cancel).not.toHaveBeenCalled();
            // `type: null` on both: the entity the notification names is not one
            // this build can act on, so the shell must not pretend it knows.
            expect(onAction).toHaveBeenNthCalledWith(1, {
                originalId: 777,
                actionId: 'tap',
                actionType: 'TODO_ACTIONS',
                type: null,
                entityId: undefined,
            });
            expect(onAction).toHaveBeenNthCalledWith(2, {
                originalId: 778,
                actionId: 'tap',
                actionType: 'TODO_ACTIONS',
                type: null,
                entityId: undefined,
            });
        });

        it('takes the entity from the notification metadata, not from the action type', async () => {
            // `TODO_ACTIONS` only says which button was shown; a caller may pass
            // any action type to `scheduleTodoNotification`, and a subject
            // reminder can be armed with it. Keying the auto-cancel off the
            // metadata is what keeps a subject reminder from being deleted by a
            // todo-shaped tap.
            useAndroid();
            const { listener, onAction } = await captureListeners();

            await listener('localNotificationActionPerformed')({
                actionId: 'mark-done',
                notification: {
                    id: getNotificationId('subject', 21),
                    extra: { type: 'subject', entityId: 21, date: '2026-09-25', originalId: 21 },
                    actionTypeId: 'TODO_ACTIONS',
                },
            });

            expect(mocks.notifications.cancel).not.toHaveBeenCalled();
            expect(onAction).toHaveBeenCalledWith({
                originalId: 21,
                actionId: 'mark-done',
                actionType: 'TODO_ACTIONS',
                type: 'subject',
                entityId: 21,
            });
        });

        it('cancels a todo reminder whose action type is a custom string', async () => {
            // The mirror image: the entity decides, so a caller that arms a todo
            // reminder with its own action type still gets the alarm cleared.
            useAndroid();
            const { listener } = await captureListeners();

            await listener('localNotificationActionPerformed')({
                actionId: 'snooze',
                notification: {
                    id: getNotificationId('todo', 8),
                    extra: { type: 'todo', entityId: 8, date: '2026-09-25', originalId: 8 },
                    actionTypeId: 'CUSTOM_TODO_ACTIONS',
                },
            });

            expect(mocks.notifications.cancel).toHaveBeenCalledWith({
                notifications: [{ id: getNotificationId('todo', 8) }],
            });
        });

        it('maps a received notification back to its entity and action type', async () => {
            useAndroid();
            const { listener, onReceive } = await captureListeners();

            await listener('localNotificationReceived')({
                id: 5,
                extra: { type: 'todo', entityId: 7, date: '2026-09-25', originalId: 7 },
                actionTypeId: 'TODO_ACTIONS',
            });
            expect(onReceive).toHaveBeenNthCalledWith(1, {
                originalId: 7,
                actionType: 'TODO_ACTIONS',
                type: 'todo',
                entityId: 7,
            });

            await listener('localNotificationReceived')({ id: 5 });
            // No metadata at all: the entity is unknown, which is reported as
            // `null` rather than guessed from the notification id.
            expect(onReceive).toHaveBeenNthCalledWith(2, {
                originalId: 5,
                actionType: undefined,
                type: null,
                entityId: undefined,
            });
        });
    });
});
