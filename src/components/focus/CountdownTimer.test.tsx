import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    native: true,
    requestPermission: vi.fn(),
    scheduleAlarm: vi.fn(),
    cancelAlarm: vi.fn(),
    scheduleNotification: vi.fn(),
    cancelTimerNotifications: vi.fn(),
    requestNotificationsPermission: vi.fn(),
    keepAwake: vi.fn(),
    allowSleep: vi.fn(),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    checkManageOverlayPermission: vi.fn(),
    requestManageOverlayPermission: vi.fn(),
    startForegroundService: vi.fn(),
    stopForegroundService: vi.fn(),
    updateForegroundService: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn((name: string) => ({ __plugin: name })),
    Capacitor: {
        isNativePlatform: () => mocks.native,
        getPlatform: () => (mocks.native ? 'android' : 'web'),
    },
}));

vi.mock('@capacitor/local-notifications', () => ({
    LocalNotifications: {
        cancel: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@capacitor-community/keep-awake', () => ({
    KeepAwake: {
        keepAwake: mocks.keepAwake,
        allowSleep: mocks.allowSleep,
    },
}));

vi.mock('@capawesome-team/capacitor-android-foreground-service', () => ({
    ForegroundService: {
        checkPermissions: mocks.checkPermissions,
        requestPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
        checkManageOverlayPermission: mocks.checkManageOverlayPermission,
        requestManageOverlayPermission: mocks.requestManageOverlayPermission,
        startForegroundService: mocks.startForegroundService,
        stopForegroundService: mocks.stopForegroundService,
        updateForegroundService: mocks.updateForegroundService,
    },
}));

vi.mock('../../native/NativeAlarm', async () => {
    const actual = await vi.importActual<typeof import('../../native/NativeAlarm')>('../../native/NativeAlarm');
    return {
        ...actual,
        default: {
            scheduleAlarm: mocks.scheduleAlarm,
            cancelAlarm: mocks.cancelAlarm,
        },
    };
});

vi.mock('../../services/notificationService', () => ({
    TIMER_NOTIFICATION_ID: 101,
    NotificationService: {
        requestPermissions: mocks.requestNotificationsPermission,
        scheduleNotification: mocks.scheduleNotification,
        cancelTimerNotifications: mocks.cancelTimerNotifications,
    },
}));

import CountdownTimer, { isForeignAlarmActive, timerProgressPercent, validateTimerInput } from './CountdownTimer';

class MockAudio {
    static instances: MockAudio[] = [];
    /** Held by the next `play()` so a test can model a `play()` that outlives its caller. */
    static blockNextPlay: Promise<void> | null = null;
    loop = false;
    crossOrigin = '';
    currentTime = 0;
    pause = vi.fn();
    play = vi.fn(() => {
        const blocked = MockAudio.blockNextPlay;
        if (blocked) {
            MockAudio.blockNextPlay = null;
            return blocked;
        }
        return Promise.resolve();
    });
    constructor() {
        MockAudio.instances.push(this);
    }
}

const flush = async () => {
    for (let turn = 0; turn < 12; turn += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
};

describe('CountdownTimer', () => {
    beforeEach(() => {
        mocks.native = true;
        vi.useFakeTimers();
        vi.clearAllMocks();
        MockAudio.instances = [];
        MockAudio.blockNextPlay = null;
        mocks.requestNotificationsPermission.mockResolvedValue(true);
        mocks.scheduleAlarm.mockResolvedValue(undefined);
        mocks.cancelAlarm.mockResolvedValue(undefined);
        mocks.scheduleNotification.mockResolvedValue({ success: true });
        mocks.cancelTimerNotifications.mockResolvedValue(true);
        mocks.keepAwake.mockResolvedValue(undefined);
        mocks.allowSleep.mockResolvedValue(undefined);
        mocks.checkPermissions.mockResolvedValue({ display: 'granted' });
        mocks.checkManageOverlayPermission.mockResolvedValue({ granted: true });
        mocks.startForegroundService.mockResolvedValue(undefined);
        mocks.stopForegroundService.mockResolvedValue(undefined);
        mocks.updateForegroundService.mockResolvedValue(undefined);
        vi.stubGlobal('Audio', MockAudio);
        vi.stubGlobal(
            'Notification',
            class {
                static permission = 'default';
                static requestPermission = mocks.requestPermission;
                close = vi.fn();
            },
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reports a session reminder the device refused to arm instead of ending in silence', async () => {
        // The authoritative alert failed, so nothing will ring once the app is
        // backgrounded. That has to be visible on the card, not swallowed.
        mocks.scheduleNotification.mockResolvedValue({ success: false, error: 'Exact alarm permission not granted' });
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();

        expect(screen.getByText(/would not arm the session reminder/i)).toBeInTheDocument();
    });

    it('clears a stale arm warning once a later session is armed', async () => {
        mocks.scheduleNotification.mockResolvedValueOnce({ success: false, error: 'nope' });
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(screen.getByText(/would not arm the session reminder/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Pause focus timer' }));
        await flush();
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();

        expect(screen.queryByText(/would not arm the session reminder/i)).not.toBeInTheDocument();
    });

    it('validates timer ranges before saving', () => {
        expect(validateTimerInput(0, 30, 0)).toBe(1800);
        expect(validateTimerInput(24, 0, 0)).toBeNull();
        expect(validateTimerInput(0, 60, 0)).toBeNull();
        expect(validateTimerInput(0, 0, 0)).toBeNull();
        expect(validateTimerInput(0.5, 0, 0)).toBeNull();
    });

    it('does not request notification permission on mount and cancels on pause', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        expect(mocks.requestNotificationsPermission).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(mocks.requestNotificationsPermission).toHaveBeenCalledTimes(1);
        // One authoritative alert per session: the plugin notification on the
        // app's own channel. A second arming under the same id would ring twice,
        // from two channels, and launch two activities.
        expect(mocks.scheduleNotification).toHaveBeenCalledWith(
            101,
            expect.any(String),
            expect.any(String),
            expect.any(Date),
            'ALARM_ACTIONS',
            'timer',
        );
        expect(mocks.scheduleAlarm).not.toHaveBeenCalled();

        await act(async () => {
            vi.advanceTimersByTime(5000);
        });
        expect(screen.getByText(/running/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Pause focus timer' }));
        await flush();
        expect(mocks.cancelAlarm).toHaveBeenCalledWith({ id: 101 });
        expect(mocks.cancelTimerNotifications).toHaveBeenCalled();
    });

    it('rejects an out-of-range edited duration and links the message to the fields', () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByTitle('Click to edit time'));
        fireEvent.change(screen.getByLabelText('HRS'), { target: { value: '24' } });
        fireEvent.click(screen.getByRole('button', { name: /set timer/i }));

        const message = screen.getByRole('alert');
        expect(message).toHaveTextContent(/00:00:01 to 23:59:59/i);
        expect(screen.getByLabelText('HRS')).toHaveAttribute('aria-describedby', message.id);
        expect(screen.getByLabelText('HRS')).toHaveAttribute('aria-invalid', 'true');
    });

    it('applies a valid edited duration', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByTitle('Click to edit time'));
        fireEvent.change(screen.getByLabelText('MIN'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: /set timer/i }));
        await flush();

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByText('05:00')).toBeInTheDocument();
    });

    it('does not stop a foreground service or a keep-awake it never started on mount', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        await flush();
        expect(mocks.startForegroundService).not.toHaveBeenCalled();
        expect(mocks.stopForegroundService).not.toHaveBeenCalled();
        // The app-level alarm holds its own keep-awake; a bare mount must not
        // release it and let the screen sleep mid-alarm.
        expect(mocks.allowSleep).not.toHaveBeenCalled();
    });

    it('stops its own foreground service and keep-awake when unmounted mid-session', async () => {
        const { unmount } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(mocks.startForegroundService).toHaveBeenCalledWith(expect.objectContaining({ id: 111 }));
        expect(mocks.keepAwake).toHaveBeenCalledTimes(1);

        mocks.stopForegroundService.mockClear();
        unmount();
        await flush();
        expect(mocks.stopForegroundService).toHaveBeenCalledTimes(1);
        expect(mocks.allowSleep).toHaveBeenCalledTimes(1);
    });

    it('re-arms the native alarm when extra time is added to a running session', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        const armedAt = Date.now() + 30 * 60 * 1000;
        expect(mocks.scheduleNotification).toHaveBeenLastCalledWith(
            101,
            expect.any(String),
            expect.any(String),
            new Date(armedAt),
            'ALARM_ACTIONS',
            'timer',
        );

        await act(async () => {
            vi.advanceTimersByTime(5000);
        });
        fireEvent.click(screen.getByTitle('Add 30s'));
        await flush();

        // Without a re-arm the alarm would ring 30s before the card reaches zero.
        expect(mocks.scheduleNotification).toHaveBeenLastCalledWith(
            101,
            expect.any(String),
            expect.any(String),
            new Date(armedAt + 30000),
            'ALARM_ACTIONS',
            'timer',
        );
    });

    it('keeps the last re-arm when two extensions land in the same tick', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        const armedAt = Date.now() + 30 * 60 * 1000;

        fireEvent.click(screen.getByTitle('Add 10s'));
        fireEvent.click(screen.getByTitle('Add 30s'));
        await flush();

        expect(mocks.scheduleNotification).toHaveBeenLastCalledWith(
            101,
            expect.any(String),
            expect.any(String),
            new Date(armedAt + 40000),
            'ALARM_ACTIONS',
            'timer',
        );
    });

    it('resumes from the remaining seconds after a pause', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(120_000);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Pause focus timer' }));
        await flush();
        expect(screen.getByText('28:00')).toBeInTheDocument();

        const resumeAt = Date.now() + 28 * 60 * 1000;
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(mocks.scheduleNotification).toHaveBeenLastCalledWith(
            101,
            expect.any(String),
            expect.any(String),
            new Date(resumeAt),
            'ALARM_ACTIONS',
            'timer',
        );
    });

    it('resets a running session back to the armed duration and cancels its alarm', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(60_000);
        });
        expect(screen.getByText(/^29:0\d$/)).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Reset'));
        await flush();
        expect(screen.getByText('30:00')).toBeInTheDocument();
        expect(mocks.cancelTimerNotifications).toHaveBeenCalled();
    });

    it('restores the armed duration when the session completes so the timer can restart', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();

        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });

        expect(screen.getByText('30:00')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(mocks.scheduleNotification).toHaveBeenCalledTimes(2);
    });

    it('exposes the session progress as a progressbar', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        expect(screen.getByRole('progressbar', { name: /focus timer progress/i })).toHaveAttribute(
            'aria-valuenow',
            '100',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(15 * 60 * 1000);
        });

        const progress = screen.getByRole('progressbar', { name: /focus timer progress/i });
        expect(progress).toHaveAttribute('aria-valuenow', '50');
        expect(progress).toHaveAttribute('aria-valuetext', '15:00 of 30:00 remaining');
    });

    it('silences the local alarm when the app-level alarm takes over', async () => {
        const { rerender } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });
        expect(MockAudio.instances).toHaveLength(1);
        expect(MockAudio.instances[0]?.play).toHaveBeenCalled();

        rerender(<CountdownTimer globalAlarmSource="ALARM_ACTIONS" stopGlobalAlarm={vi.fn()} />);
        await flush();
        expect(MockAudio.instances[0]?.pause).toHaveBeenCalled();
    });

    it('cancels the vibration pattern when the alarm is stopped', async () => {
        const { rerender } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });
        expect(navigator.vibrate).toHaveBeenCalledWith([1000, 500, 1000, 500, 1000, 500, 1000]);

        rerender(<CountdownTimer globalAlarmSource="ALARM_ACTIONS" stopGlobalAlarm={vi.fn()} />);
        await flush();
        // vibrate(0) is the only way to end a running pattern.
        expect(navigator.vibrate).toHaveBeenCalledWith(0);
    });

    it('stays silent when the app-level alarm already owns the alert', async () => {
        // The in-page tick and the `localNotificationReceived` callback in `App`
        // both fire for the same focus completion. When the app-level overlay is
        // already up, a second tone and a second aria-modal dialog must not stack
        // on top of it.
        render(<CountdownTimer globalAlarmSource="ALARM_ACTIONS" stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();

        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });

        expect(MockAudio.instances).toHaveLength(0);
        expect(screen.queryByRole('dialog', { name: /time's up!/i })).not.toBeInTheDocument();
    });

    it('never claims a ringing overlay it does not own', () => {
        // The app shell owns the one in-app ringing overlay, on every route, for
        // every source. The timer must not add a second `aria-modal` dialog on top
        // of it - including for the source that the focus card's own (now removed)
        // overlay used to key off.
        const { rerender } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        expect(screen.queryByRole('dialog', { name: /time's up!/i })).not.toBeInTheDocument();

        for (const source of ['SYSTEM', 'ALARM_ACTIONS', 'FOCUS_ALARM']) {
            rerender(<CountdownTimer globalAlarmSource={source} stopGlobalAlarm={vi.fn()} />);
            expect(screen.queryByRole('dialog', { name: /time's up!/i })).not.toBeInTheDocument();
        }
    });

    it('classifies whether some other alarm is already ringing', () => {
        // A focus-list alarm is a ring like any other. Excluding it here is what
        // let a focus alarm and a finished session ring together on `/focus`.
        expect(isForeignAlarmActive(null)).toBe(false);
        expect(isForeignAlarmActive(undefined)).toBe(false);
        expect(isForeignAlarmActive('')).toBe(true);
        expect(isForeignAlarmActive('ALARM_ACTIONS')).toBe(true);
        expect(isForeignAlarmActive('TODO_ACTIONS')).toBe(true);
        expect(isForeignAlarmActive('FOCUS_ALARM')).toBe(true);
    });

    it('stands down for an app-level ring that starts after the session ends', async () => {
        // The session finished first, so the local alert is already ringing, and
        // then a scheduled alarm fires. Two `aria-modal` dialogs and two audio
        // graphs for one screen used to be what the user got.
        const { rerender } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });
        expect(screen.getByRole('dialog', { name: /time's up!/i })).toBeInTheDocument();

        rerender(<CountdownTimer globalAlarmSource="FOCUS_ALARM" stopGlobalAlarm={vi.fn()} />);
        await flush();

        // The shell's overlay replaces the one the timer had, and the tone stops
        // with it - the shell's overlay is the only stop control on screen.
        expect(screen.queryByRole('dialog', { name: /time's up!/i })).not.toBeInTheDocument();
        expect(MockAudio.instances[0]?.pause).toHaveBeenCalled();
        expect(vi.mocked(navigator.vibrate).mock.lastCall).toEqual([0]);
    });

    it('stays silent when an app-level alarm is already ringing when the session ends', async () => {
        render(<CountdownTimer globalAlarmSource="FOCUS_ALARM" stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();

        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });

        expect(MockAudio.instances).toHaveLength(0);
        // `vibrate(0)` is called by the start path to clear a previous pattern, so
        // the assertion is about the alarm pattern, not about the API at all.
        expect(navigator.vibrate).not.toHaveBeenCalledWith([1000, 500, 1000, 500, 1000, 500, 1000]);
        expect(screen.queryByRole('dialog', { name: /time's up!/i })).not.toBeInTheDocument();
    });

    it('keeps the stop control reachable while the timer card is collapsed', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });

        fireEvent.click(screen.getByRole('button', { name: /^Focus Timer/i }));

        const dialog = screen.getByRole('dialog', { name: /time's up!/i });
        expect(dialog.closest('.overflow-hidden')).toBeNull();
        const stop = screen.getByRole('button', { name: /stop alarm/i });
        expect(stop).toBeInTheDocument();
        expect(stop).toHaveFocus();
    });

    it('stops its own alarm from the overlay without silencing the app-level one it does not own', async () => {
        const stopGlobalAlarm = vi.fn();
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={stopGlobalAlarm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });

        fireEvent.click(screen.getByRole('button', { name: /stop alarm/i }));
        expect(MockAudio.instances[0]?.pause).toHaveBeenCalled();
        expect(stopGlobalAlarm).toHaveBeenCalledTimes(1);
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        expect(screen.queryByRole('dialog', { name: /time's up!/i })).toBeNull();
    });

    it('does not create an audio resource until an alarm actually fires', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        await flush();
        expect(MockAudio.instances).toHaveLength(0);
    });

    it('stops a still-ringing alarm and its vibration when it unmounts', async () => {
        const { unmount } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });
        expect(navigator.vibrate).toHaveBeenCalledWith([1000, 500, 1000, 500, 1000, 500, 1000]);
        expect(screen.getByRole('dialog', { name: /time's up!/i })).toBeInTheDocument();
        // Starting the session already called `vibrate(0)` once to clear the previous
        // pattern, so only a *new* call proves the unmount did anything.
        const vibrateCallsBeforeUnmount = vi.mocked(navigator.vibrate).mock.calls.length;
        const pauseCallsBeforeUnmount = MockAudio.instances[0]?.pause.mock.calls.length ?? 0;

        // Disposing the audio graph is not enough on its own: the media element
        // would keep playing and the pattern would keep buzzing with no control
        // left anywhere to stop them.
        unmount();

        expect(vi.mocked(navigator.vibrate).mock.calls.length).toBeGreaterThan(vibrateCallsBeforeUnmount);
        expect(vi.mocked(navigator.vibrate).mock.lastCall).toEqual([0]);
        expect(MockAudio.instances[0]?.pause.mock.calls.length ?? 0).toBeGreaterThan(pauseCallsBeforeUnmount);
    });

    it('stops an alarm whose play() only lands after the component unmounted', async () => {
        let releasePlay: (() => void) | undefined;
        mocks.native = false;
        MockAudio.blockNextPlay = new Promise<void>((resolve) => {
            releasePlay = resolve;
        });
        const { unmount } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        // The media element blocks inside `play()`, so the `await` in `playAlarm` is
        // still pending when the component goes away.
        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });

        unmount();
        // The unmount's own cleanup already stopped the element and cancelled the
        // pattern once; `dispose()` also drops the media element, so a later
        // `stop()` on that controller cannot be what silences this.
        const vibrateCallsAfterUnmount = vi.mocked(navigator.vibrate).mock.calls.length;
        expect(vi.mocked(navigator.vibrate).mock.lastCall).toEqual([0]);

        releasePlay?.();
        await flush();

        // The pattern the unmounted component started was still running, and
        // nothing else would ever cancel it: the phone would keep buzzing.
        expect(vi.mocked(navigator.vibrate).mock.calls.length).toBeGreaterThan(vibrateCallsAfterUnmount);
        expect(vi.mocked(navigator.vibrate).mock.lastCall).toEqual([0]);
    });

    it('stops a foreground service that finishes starting after the unmount', async () => {
        let releaseStart: (() => void) | undefined;
        mocks.startForegroundService.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releaseStart = resolve;
                }),
        );
        const { unmount } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(releaseStart).toBeDefined();

        // The cleanup ran before the service existed, so it had nothing to stop.
        unmount();
        await flush();
        releaseStart?.();
        await flush();

        expect(mocks.stopForegroundService).toHaveBeenCalledTimes(1);
    });

    it('stops before it restarts, so a pause resumed a moment later keeps its service', async () => {
        // Both calls are bridge round trips and nothing ordered them, so a stop
        // that landed after the next start left the timer counting down against a
        // dead service with no error anywhere to explain it.
        const order: string[] = [];
        let releaseStop: (() => void) | undefined;
        mocks.stopForegroundService.mockImplementation(() => {
            order.push('stop');
            return new Promise<void>((resolve) => {
                releaseStop = resolve;
            });
        });
        mocks.startForegroundService.mockImplementation(() => {
            order.push('start');
            return Promise.resolve();
        });
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(order).toEqual(['start']);

        fireEvent.click(screen.getByRole('button', { name: 'Pause focus timer' }));
        await flush();
        expect(order).toEqual(['start', 'stop']);

        // Resumed while the pause's stop is still in flight.
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(order).toEqual(['start', 'stop']);

        releaseStop?.();
        await flush();
        expect(order).toEqual(['start', 'stop', 'start']);
    });

    it('does not start a service for a session that was stopped before the start was issued', async () => {
        let releaseStart: (() => void) | undefined;
        mocks.startForegroundService.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseStart = resolve;
                }),
        );
        const { unmount } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(releaseStart).toBeDefined();

        unmount();
        await flush();
        releaseStart?.();
        await flush();

        // One start was already in flight, so the teardown only has to stop that
        // one. Starting a second would leave a service nothing would ever stop.
        expect(mocks.startForegroundService).toHaveBeenCalledTimes(1);
        expect(mocks.stopForegroundService).toHaveBeenCalledTimes(1);
    });

    it('does not claim a foreground service it failed to start', async () => {
        mocks.startForegroundService.mockRejectedValue(new Error('permission denied'));
        const { unmount } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();

        unmount();
        await flush();

        // Nothing is running, so the teardown must not stop a service it does not
        // own - the app-level alarm runs one under a different id.
        expect(mocks.stopForegroundService).not.toHaveBeenCalled();
    });

    it('never claims a service for a session torn down during the permission round trip', async () => {
        // The teardown runs before the claim is reached, so it has no service to
        // stop and cannot clear the claim. Left in place, the *next* teardown issues
        // a stop for a service this component never started - and the plugin's stop
        // is not scoped to an id, so that is the app-level alarm's service.
        let releasePermission: ((value: { display: string }) => void) | undefined;
        mocks.checkPermissions.mockImplementationOnce(
            () =>
                new Promise<{ display: string }>((resolve) => {
                    releasePermission = resolve;
                }),
        );
        const { unmount } = render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        expect(releasePermission).toBeDefined();

        // Paused while the permission round trip is still open, so the teardown
        // finds nothing claimed and leaves the run to finish on its own.
        fireEvent.click(screen.getByRole('button', { name: 'Pause focus timer' }));
        await flush();
        releasePermission?.({ display: 'granted' });
        await flush();
        expect(mocks.startForegroundService).not.toHaveBeenCalled();

        unmount();
        await flush();

        // Nothing was ever started, so nothing may be stopped on the way out.
        expect(mocks.stopForegroundService).not.toHaveBeenCalled();
    });

    it('keeps the keyboard inside the ringing overlay and hands it back on close', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        const start = screen.getByRole('button', { name: 'Start focus timer' });
        start.focus();
        fireEvent.click(start);
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });
        const stop = screen.getByRole('button', { name: /stop alarm/i });
        expect(stop).toHaveFocus();

        // jsdom performs no tab navigation of its own, so the observable half of
        // "focus stays inside" is that the key is consumed: left alone, Tab walks
        // straight out of the dialog into the controls it is covering.
        const seen: KeyboardEvent[] = [];
        const record = (event: KeyboardEvent) => seen.push(event);
        document.addEventListener('keydown', record);
        try {
            fireEvent.keyDown(document, { key: 'Tab' });
            expect(seen.at(-1)?.defaultPrevented).toBe(true);
            expect(stop).toHaveFocus();
        } finally {
            document.removeEventListener('keydown', record);
        }

        fireEvent.click(stop);
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });

        // Otherwise the caret lands on `<body` and the tab sequence restarts at
        // the top of the page.
        expect(start).toHaveFocus();
    });

    it('removes the ringing overlay from the page as soon as the alarm is stopped', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(30 * 60 * 1000 + 1000);
        });
        expect(screen.getByRole('dialog', { name: /time's up!/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /stop alarm/i }));

        // A deferred exit animation would leave an `aria-modal` dialog announced to
        // assistive tech, still holding the only stop control, long after the alarm
        // is silent.
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        expect(screen.queryByRole('dialog', { name: /time's up!/i })).toBeNull();
    });

    it('keeps idle extra time inside the armed duration so the progress bar can move', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        expect(screen.getByRole('progressbar', { name: /focus timer progress/i })).toHaveAttribute(
            'aria-valuenow',
            '100',
        );

        fireEvent.click(screen.getByTitle('Add 10s'));
        fireEvent.click(screen.getByTitle('Add 30s'));

        // Otherwise the bar clamps at 100% forever and claims more time remaining
        // than the next session would actually run for.
        const progress = screen.getByRole('progressbar', { name: /focus timer progress/i });
        expect(progress).toHaveAttribute('aria-valuenow', '100');
        expect(progress).toHaveAttribute('aria-valuetext', '30:40 of 30:40 remaining');

        fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(20 * 1000);
        });
        expect(screen.getByRole('progressbar', { name: /focus timer progress/i })).toHaveAttribute(
            'aria-valuetext',
            '30:20 of 30:40 remaining',
        );
    });

    it('resets to the extended duration rather than throwing the extra time away', async () => {
        render(<CountdownTimer globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />);
        fireEvent.click(screen.getByTitle('Add 30s'));
        expect(screen.getByText('30:30')).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Reset'));
        await flush();

        expect(screen.getByText('30:30')).toBeInTheDocument();
    });

    it('clamps the progress bar when extra time is added beyond the armed duration', () => {
        expect(timerProgressPercent(1830, 1800)).toBe(100);
        expect(timerProgressPercent(-1, 1800)).toBe(0);
        expect(timerProgressPercent(900, 1800)).toBe(50);
        expect(timerProgressPercent(10, 0)).toBe(0);
    });
});
