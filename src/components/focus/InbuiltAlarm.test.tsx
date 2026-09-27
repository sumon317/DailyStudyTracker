import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FOCUS_ALARMS } from '../../native/NativeAlarm';
import { ToastProvider } from '../../providers/ToastProvider';
import { DATA_IMPORTED_EVENT } from '../../services/dataImportEvents';

const mocks = vi.hoisted(() => ({
    native: true,
    scheduleAlarm: vi.fn(),
    cancelAlarm: vi.fn(),
    syncAlarms: vi.fn(),
    reconcileAlarms: vi.fn(),
    resumeListeners: [] as (() => void)[],
    resumeListenerRemove: vi.fn(),
    addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn((name: string) => ({ __plugin: name })),
    Capacitor: {
        isNativePlatform: () => mocks.native,
        getPlatform: () => (mocks.native ? 'android' : 'web'),
    },
}));

vi.mock('@capacitor/app', () => ({
    // The plugin's real export name: `@capacitor/app` exports `App`, and
    // `CapacitorApp` was only ever the (nonexistent) spelling a previous pass
    // invented, which is why the import had to be cast to typecheck.
    App: {
        addListener: mocks.addListener,
    },
}));

vi.mock('@capacitor/local-notifications', () => ({
    LocalNotifications: {
        checkPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
        requestPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
        checkExactNotificationSetting: vi.fn().mockResolvedValue({ exact_alarm: 'granted' }),
        changeExactNotificationSetting: vi.fn().mockResolvedValue({ exact_alarm: 'granted' }),
        createChannel: vi.fn().mockResolvedValue(undefined),
        registerActionTypes: vi.fn().mockResolvedValue(undefined),
        removeAllListeners: vi.fn().mockResolvedValue(undefined),
        addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
        schedule: vi.fn().mockResolvedValue({ notifications: [] }),
        cancel: vi.fn().mockResolvedValue(undefined),
        getPending: vi.fn().mockResolvedValue({ notifications: [] }),
        removeDeliveredNotificationsById: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../native/NativeAlarm', async () => {
    const actual = await vi.importActual<typeof import('../../native/NativeAlarm')>('../../native/NativeAlarm');
    return {
        ...actual,
        default: {
            scheduleAlarm: mocks.scheduleAlarm,
            cancelAlarm: mocks.cancelAlarm,
            syncAlarms: mocks.syncAlarms,
            reconcileAlarms: mocks.reconcileAlarms,
        },
    };
});

import {
    getFocusAlarmId,
    getNotificationId,
    NotificationService,
    TIMER_NOTIFICATION_ID,
} from '../../services/notificationService';
import InbuiltAlarm, { buildFocusAlarmDefinitions, isValidAlarmTime } from './InbuiltAlarm';

const STORAGE_KEY = 'focusAlarms';
const ALARM_ID = 'focus-armed-1';

const seedAlarms = (entries: unknown[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
};

const readStored = (): { id: string; time: string; active: boolean }[] =>
    JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');

const setVisibility = (value: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
};

const renderAlarms = () =>
    render(
        <ToastProvider>
            <InbuiltAlarm />
        </ToastProvider>,
    );

const emitResume = () => {
    for (const listener of mocks.resumeListeners) {
        listener();
    }
};

describe('InbuiltAlarm', () => {
    beforeEach(() => {
        mocks.native = true;
        localStorage.clear();
        vi.clearAllMocks();
        mocks.resumeListeners = [];
        mocks.resumeListenerRemove = vi.fn();
        mocks.addListener.mockImplementation((_event: string, listener: () => void) => {
            mocks.resumeListeners.push(listener);
            return Promise.resolve({ remove: mocks.resumeListenerRemove });
        });
        mocks.scheduleAlarm.mockResolvedValue(undefined);
        mocks.cancelAlarm.mockResolvedValue(undefined);
        mocks.reconcileAlarms.mockResolvedValue(undefined);
        setVisibility('visible');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('validates alarm time strings', () => {
        expect(isValidAlarmTime('07:05')).toBe(true);
        expect(isValidAlarmTime('24:00')).toBe(false);
        expect(isValidAlarmTime('7:05')).toBe(false);
        expect(isValidAlarmTime(705)).toBe(false);
    });

    it('arms the native alarm for stored active entries without a bulk sync', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        renderAlarms();

        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalled());
        expect(mocks.syncAlarms).not.toHaveBeenCalled();
        expect(mocks.scheduleAlarm).toHaveBeenCalledWith(
            expect.objectContaining({ id: getNotificationId('focus-alarm', ALARM_ID), title: 'Focus Alarm' }),
        );
    });

    it('never cancels the countdown timer native id when a focus alarm is removed', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        renderAlarms();
        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: `Delete alarm at 07:05` }));

        await waitFor(() =>
            expect(mocks.cancelAlarm).toHaveBeenCalledWith({
                id: getNotificationId('focus-alarm', ALARM_ID),
            }),
        );
        for (const [options] of mocks.cancelAlarm.mock.calls) {
            expect(options.id).not.toBe(TIMER_NOTIFICATION_ID);
        }
        expect(mocks.syncAlarms).not.toHaveBeenCalled();
    });

    it('re-arms persisted alarms through the reboot bridge when the app resumes', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        renderAlarms();
        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalled());
        mocks.reconcileAlarms.mockClear();

        setVisibility('hidden');
        fireEvent(document, new Event('visibilitychange'));
        expect(mocks.reconcileAlarms).not.toHaveBeenCalled();

        setVisibility('visible');
        fireEvent(document, new Event('visibilitychange'));
        await waitFor(() => expect(mocks.reconcileAlarms).toHaveBeenCalledTimes(1));
    });

    it('re-arms on the native resume event, not only on visibilitychange', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        renderAlarms();
        await waitFor(() => expect(mocks.addListener).toHaveBeenCalledWith('resume', expect.any(Function)));
        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalled());
        mocks.reconcileAlarms.mockClear();
        mocks.scheduleAlarm.mockClear();

        // A Capacitor WebView does not always flip document.visibilityState, so the
        // native resume event has to be the reliable re-arm signal.
        emitResume();
        await waitFor(() => expect(mocks.reconcileAlarms).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalledTimes(1));
    });

    it('removes its resume listener when it unmounts', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        const { unmount } = renderAlarms();
        await waitFor(() => expect(mocks.addListener).toHaveBeenCalled());
        expect(mocks.resumeListenerRemove).not.toHaveBeenCalled();

        unmount();
        await waitFor(() => expect(mocks.resumeListenerRemove).toHaveBeenCalled());
    });

    it('does not let a stale reconcile pass re-arm an alarm that was just switched off', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        let releaseSchedule: (() => void) | undefined;
        mocks.scheduleAlarm.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseSchedule = resolve;
                }),
        );
        renderAlarms();
        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalledTimes(1));

        // The first pass is still in flight when the user switches the alarm off.
        fireEvent.click(screen.getByRole('button', { name: 'Turn off alarm at 07:05' }));
        await waitFor(() => expect(mocks.cancelAlarm).toHaveBeenCalled());
        expect(readStored()[0]?.active).toBe(false);

        // Landing the in-flight pass afterwards must not re-create the native alarm.
        releaseSchedule?.();
        await waitFor(() => expect(mocks.cancelAlarm).toHaveBeenCalled());
        const scheduledIds = mocks.scheduleAlarm.mock.calls.map(([options]) => options.id);
        expect(scheduledIds.filter((id) => id === getNotificationId('focus-alarm', ALARM_ID))).toHaveLength(1);
    });

    it('keeps armed alarms armed after a browser session re-persists them', async () => {
        mocks.native = false;
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        renderAlarms();

        expect(screen.getByText(/1 Active/)).toBeInTheDocument();
        expect(readStored()[0]?.active).toBe(true);
        expect(mocks.scheduleAlarm).not.toHaveBeenCalled();
    });

    it('explains why a browser cannot arm an alarm instead of failing silently', async () => {
        mocks.native = false;
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: false }]);
        renderAlarms();

        fireEvent.click(screen.getByRole('button', { name: 'Turn on alarm at 07:05' }));

        const toasts = await screen.findAllByRole('alert');
        expect(toasts).toHaveLength(1);
        expect(toasts[0]).toHaveTextContent(/delivered by Android only/i);
        expect(mocks.scheduleAlarm).not.toHaveBeenCalled();
    });

    it('renders no ringing stop control of its own, collapsed or not', () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: false }]);
        renderAlarms();

        fireEvent.click(screen.getByRole('button', { name: /Real Alarms/i }));

        // The shell is the only in-app owner of the ringing overlay. This card
        // used to render a second `aria-modal` dialog whenever the app-level
        // alarm source read `'FOCUS_ALARM'` - a value nothing registers with the
        // notification plugin, so the branch was unreachable and the dialog it
        // guarded was the one that made a real alarm need dismissing twice. The
        // card's own job is arming, and Android delivers the ring.
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /stop alarm/i })).not.toBeInTheDocument();
        // The list itself is unaffected by having no overlay.
        expect(screen.getByRole('button', { name: 'Turn on alarm at 07:05' })).toBeInTheDocument();
    });

    it('blocks the row controls until a pending native cancellation settles', async () => {
        // A second press on a row control would issue a second native mutation for
        // an id the first has already retired, so the row is locked for the round
        // trip rather than left live behind a `disabled` attribute that only covers
        // the next tick.
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: false }]);
        let releaseCancel: (() => void) | undefined;
        mocks.cancelAlarm.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseCancel = () => resolve();
                }),
        );
        renderAlarms();

        fireEvent.click(screen.getByRole('button', { name: 'Delete alarm at 07:05' }));
        expect(screen.getByRole('button', { name: 'Turn on alarm at 07:05' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Delete alarm at 07:05' })).toBeDisabled();

        releaseCancel?.();
        await waitFor(() => expect(readStored()).toHaveLength(0));
        expect(mocks.cancelAlarm).toHaveBeenCalledTimes(1);
    });

    it('cancels the armed native id when a time really changes', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        renderAlarms();
        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalled());

        // Re-arming a changed time cancels the old native alarm first.
        fireEvent.click(screen.getByRole('button', { name: /study time/i }));
        const confirm = await screen.findByRole('button', { name: /^set$/i });
        fireEvent.click(screen.getByRole('button', { name: /increase hour/i }));
        fireEvent.click(confirm);
        await waitFor(() => expect(screen.queryByRole('button', { name: /^set$/i })).not.toBeInTheDocument());
        await waitFor(() => expect(readStored()[0]?.time).toBe('08:05'));

        expect(mocks.cancelAlarm).toHaveBeenCalledWith({ id: getFocusAlarmId(ALARM_ID) });
        // The changed time invalidates the armed state, so the list must not keep
        // claiming an alarm the native side no longer holds.
        expect(readStored()[0]?.active).toBe(false);
    });

    it('does not cancel anything when the picker is confirmed with the time it already has', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        renderAlarms();
        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalled());

        // Re-opening the picker and confirming the same time is not an edit.
        // Cancelling here silently disarmed an alarm the user believes is still
        // armed while the control kept reading as on.
        fireEvent.click(screen.getByRole('button', { name: /study time/i }));
        const confirm = await screen.findByRole('button', { name: /^set$/i });
        fireEvent.click(confirm);
        await waitFor(() => expect(screen.queryByRole('button', { name: /^set$/i })).not.toBeInTheDocument());

        expect(mocks.cancelAlarm).not.toHaveBeenCalled();
        expect(readStored()[0]?.active).toBe(true);
    });

    it('keeps the stored alarm when the native cancellation fails', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: false }]);
        mocks.cancelAlarm.mockRejectedValue(new Error('bridge offline'));
        renderAlarms();

        fireEvent.click(screen.getByRole('button', { name: 'Delete alarm at 07:05' }));

        expect(await screen.findByText('Failed to remove the alarm; it is still scheduled.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete alarm at 07:05' })).toBeInTheDocument();
        expect(readStored()).toHaveLength(1);
    });

    it('reports a failed arm without marking the alarm as active', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: false }]);
        mocks.scheduleAlarm.mockRejectedValue(new Error('bridge offline'));
        renderAlarms();

        fireEvent.click(screen.getByRole('button', { name: 'Turn on alarm at 07:05' }));

        expect(await screen.findByText('Failed to schedule native alarm.')).toBeInTheDocument();
        expect(readStored()[0]?.active).toBe(false);
    });

    it('does not persist more alarms than the supported maximum', async () => {
        seedAlarms(
            Array.from({ length: MAX_FOCUS_ALARMS }, (_unused, index) => ({
                id: `focus-${index}`,
                time: '07:05',
                active: false,
            })),
        );
        renderAlarms();
        expect(readStored()).toHaveLength(MAX_FOCUS_ALARMS);

        fireEvent.click(screen.getByRole('button', { name: 'Add focus alarm' }));

        await waitFor(() => expect(readStored()).toHaveLength(MAX_FOCUS_ALARMS));
    });

    it('explains the alarm limit instead of leaving the add button inert', async () => {
        seedAlarms(
            Array.from({ length: MAX_FOCUS_ALARMS }, (_unused, index) => ({
                id: `focus-${index}`,
                time: '07:05',
                active: false,
            })),
        );
        renderAlarms();

        fireEvent.click(screen.getByRole('button', { name: 'Add focus alarm' }));

        // A control that silently does nothing reads as a broken app. The number
        // is the shared cap, not a copy of it: the component, the storage
        // validator and the native plugin have to agree, or the last alarm is
        // rejected natively while this list counts it as armed.
        const toasts = await screen.findAllByRole('alert');
        expect(toasts).toHaveLength(1);
        expect(toasts[0]).toHaveTextContent(new RegExp(`at most ${MAX_FOCUS_ALARMS} focus alarms`, 'i'));
        expect(readStored()).toHaveLength(MAX_FOCUS_ALARMS);
    });

    it('reports a reconcile that could not arm an alarm instead of showing it as active', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        mocks.scheduleAlarm.mockRejectedValue(new Error('store is full'));
        renderAlarms();

        // The mount/resume reconcile is the path that re-arms after a reboot, and
        // it used to swallow the failure, leaving the list counting an alarm that
        // nothing would ever ring.
        const toasts = await screen.findAllByRole('alert');
        expect(toasts).toHaveLength(1);
        expect(toasts[0]).toHaveTextContent(/one focus alarm could not be armed/i);
    });

    it('summarises a reconcile that could not arm several alarms in one warning', async () => {
        seedAlarms([
            { id: 'focus-a', time: '07:05', active: true },
            { id: 'focus-b', time: '08:05', active: true },
        ]);
        mocks.scheduleAlarm.mockRejectedValue(new Error('store is full'));
        renderAlarms();

        const toasts = await screen.findAllByRole('alert');
        expect(toasts).toHaveLength(1);
        expect(toasts[0]).toHaveTextContent(/2 focus alarms could not be armed/i);
    });

    it('stays silent when the reconcile arms every alarm', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        renderAlarms();

        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalled());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('subscribes to the resume event once, not once per list change', async () => {
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: false }]);
        renderAlarms();
        await waitFor(() => expect(mocks.addListener).toHaveBeenCalled());
        expect(mocks.addListener).toHaveBeenCalledTimes(1);

        // Re-subscribing on every toggle tore the listener down and back up again,
        // leaving windows where a resume was not observed and nothing was re-armed.
        fireEvent.click(screen.getByRole('button', { name: 'Turn on alarm at 07:05' }));
        await waitFor(() => expect(mocks.scheduleAlarm).toHaveBeenCalledTimes(1));
        expect(mocks.addListener).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Turn off alarm at 07:05' }));
        await waitFor(() => expect(mocks.cancelAlarm).toHaveBeenCalled());
        expect(mocks.addListener).toHaveBeenCalledTimes(1);
    });

    it('re-reads and re-arms the list when a restore replaces it', async () => {
        // The card reads its list once, at mount, so a backup carrying a
        // different one left the screen showing alarms the store no longer has.
        seedAlarms([{ id: ALARM_ID, time: '07:05', active: true }]);
        renderAlarms();
        expect(screen.getByRole('button', { name: /turn off alarm at 07:05/i })).toBeInTheDocument();

        await act(async () => {
            localStorage.setItem('focusAlarms', JSON.stringify([{ id: 'restored', time: '21:30', active: true }]));
            window.dispatchEvent(new CustomEvent(DATA_IMPORTED_EVENT, { detail: { appliedDays: 1 } }));
        });

        // Adopting the restored list also reconciles it natively, which is what
        // makes the new alarm real rather than only displayed.
        expect(await screen.findByRole('button', { name: /turn off alarm at 21:30/i })).toBeInTheDocument();
        await waitFor(() => expect(mocks.cancelAlarm).toHaveBeenCalledWith({ id: getFocusAlarmId(ALARM_ID) }));
        expect(mocks.scheduleAlarm).toHaveBeenCalledWith(expect.objectContaining({ id: getFocusAlarmId('restored') }));
    });

    describe('buildFocusAlarmDefinitions', () => {
        it('skips inactive entries, invalid times and the reserved timer id', () => {
            const now = new Date(2026, 8, 26, 10, 0, 0).getTime();
            const definitions = buildFocusAlarmDefinitions(
                [
                    { id: 'a', time: '11:00', active: true },
                    { id: 'b', time: '11:00', active: false },
                    { id: 'c', time: '', active: true },
                ],
                now,
            );
            expect(definitions).toEqual([
                {
                    id: getNotificationId('focus-alarm', 'a'),
                    time: new Date(2026, 8, 26, 11, 0, 0, 0).getTime(),
                    title: 'Focus Alarm',
                    body: 'Your scheduled alarm is ringing!',
                },
            ]);
        });

        it('rolls a time that has already passed over to tomorrow', () => {
            const now = new Date(2026, 8, 26, 23, 30, 0).getTime();
            const [definition] = buildFocusAlarmDefinitions([{ id: 'a', time: '07:05', active: true }], now);
            expect(definition?.time).toBe(new Date(2026, 8, 27, 7, 5, 0, 0).getTime());
            expect(definition?.time).toBeGreaterThan(now);
        });

        it('keeps the first of two entries that hash to the same native id', () => {
            const now = new Date(2026, 8, 26, 10, 0, 0).getTime();
            const spy = vi.spyOn(NotificationService, 'getNotificationId').mockReturnValue(4242);
            const definitions = buildFocusAlarmDefinitions(
                [
                    { id: 'a', time: '11:00', active: true },
                    { id: 'b', time: '11:00', active: true },
                ],
                now,
            );
            spy.mockRestore();
            // Both would target id 4242, so the second must be dropped rather than
            // silently overwriting the first.
            expect(definitions).toHaveLength(1);
            expect(definitions[0]?.id).toBe(4242);
        });

        it('drops an id Android would reject so the list cannot claim it is armed', () => {
            const now = new Date(2026, 8, 26, 10, 0, 0).getTime();
            // The bridge refuses anything outside 1..0x7fffffff, so an entry that
            // reached it would be rejected while the list still showed it as active.
            for (const rejectedId of [0, -5, 0x80000000, 1.5, 0x7fffffff + 1]) {
                const spy = vi.spyOn(NotificationService, 'getNotificationId').mockReturnValue(rejectedId);
                const definitions = buildFocusAlarmDefinitions([{ id: 'a', time: '11:00', active: true }], now);
                spy.mockRestore();
                expect(definitions).toEqual([]);
            }
        });

        it('keeps the largest id Android accepts', () => {
            const now = new Date(2026, 8, 26, 10, 0, 0).getTime();
            const spy = vi.spyOn(NotificationService, 'getNotificationId').mockReturnValue(0x7fffffff);
            const definitions = buildFocusAlarmDefinitions([{ id: 'a', time: '11:00', active: true }], now);
            spy.mockRestore();
            expect(definitions).toHaveLength(1);
            expect(definitions[0]?.id).toBe(0x7fffffff);
        });
    });
});
