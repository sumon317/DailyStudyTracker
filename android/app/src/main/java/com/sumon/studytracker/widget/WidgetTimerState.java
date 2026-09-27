package com.sumon.studytracker.widget;

/**
 * The per-widget timer state machine: the three button presses and the reconciliation a render
 * does, expressed as pure transitions over the values stored in
 * {@code StudyWidgetProvider.PREF_BASE_<id>}, {@code PREF_PAUSE_TIME_<id>} and
 * {@code PREF_RUNNING_<id>}.
 *
 * <p>Two properties matter and neither is visible by reading the call sites:
 *
 * <ul>
 *   <li><b>Idempotence.</b> Pressing play on a running timer, pause on a stopped one, or reset
 *       twice has to leave the displayed total alone. Re-deriving a base from the accumulated
 *       {@code pauseTime} while the timer is already running restarts the count at zero, and
 *       recomputing {@code pauseTime} as {@code now - base} for an already-stopped timer grows the
 *       total with wall-clock time alone.
 *   <li><b>Reboot safety.</b> {@code elapsedRealtime} restarts at zero on reboot while the stored
 *       values survive, so a base ahead of the current clock, or an accumulated duration larger
 *       than the clock it was measured against, can no longer be trusted. Restarting at zero is the
 *       only honest answer; inventing device uptime as study time is worse than showing nothing.
 * </ul>
 *
 * <p>Free of the framework and of {@code SystemClock} (the caller supplies the clock), so every
 * transition is covered by JVM unit tests.
 */
public final class WidgetTimerState {

    private final long base;
    private final long pauseTime;
    private final boolean running;

    private WidgetTimerState(long base, long pauseTime, boolean running) {
        this.base = base;
        this.pauseTime = pauseTime;
        this.running = running;
    }

    /** The values as stored, without any staleness reconciliation. */
    public static WidgetTimerState of(long base, long pauseTime, boolean running) {
        return new WidgetTimerState(base, pauseTime, running);
    }

    /** Play / Resume, and the notification's Resume action. */
    public static WidgetTimerState started(
            long storedBase,
            long storedPauseTime,
            boolean wasRunning,
            long nowElapsed
    ) {
        if (wasRunning) {
            // The stored base is the whole truth while running: pauseTime is 0, so rebuilding the
            // base from it would silently restart the count at zero.
            return new WidgetTimerState(sanitisedBase(storedBase, nowElapsed), 0L, true);
        }
        long pauseTime = sanitisedPauseTime(storedPauseTime, nowElapsed);
        long base = WidgetTimeUtils.baseForResume(pauseTime, nowElapsed);
        if (WidgetTimeUtils.isStaleTimerBase(base, nowElapsed)) {
            base = nowElapsed;
            pauseTime = 0L;
        }
        return new WidgetTimerState(base, pauseTime, true);
    }

    /** Pause, and the notification's Pause action. */
    public static WidgetTimerState paused(
            long storedBase,
            long storedPauseTime,
            boolean wasRunning,
            long nowElapsed
    ) {
        if (wasRunning) {
            // Freeze what the running base has accumulated. pauseTimeFor drops a reboot-stale base
            // rather than reporting "time since the base" as study time.
            return new WidgetTimerState(
                    storedBase,
                    WidgetTimeUtils.pauseTimeFor(storedBase, nowElapsed),
                    false
            );
        }
        // Already stopped: there is no elapsed window to freeze, so the stored total is kept. A
        // base left over from a reboot is re-anchored to now, because now - base would otherwise
        // be device uptime.
        return new WidgetTimerState(
                sanitisedBase(storedBase, nowElapsed),
                sanitisedPauseTime(storedPauseTime, nowElapsed),
                false
        );
    }

    /** Stop, from either the widget's reset button or the notification's Stop action. */
    public static WidgetTimerState reset(long nowElapsed) {
        return new WidgetTimerState(nowElapsed, 0L, false);
    }

    /**
     * What a render should show for values that were written by an earlier session: a base that did
     * not survive a reboot restarts the timer, anything else is passed through with a duration the
     * current boot clock can still account for.
     */
    public static WidgetTimerState reconciled(
            long storedBase,
            long storedPauseTime,
            boolean wasRunning,
            long nowElapsed
    ) {
        if (WidgetTimeUtils.isStaleTimerBase(storedBase, nowElapsed)) {
            return reset(nowElapsed);
        }
        return new WidgetTimerState(
                storedBase,
                sanitisedPauseTime(storedPauseTime, nowElapsed),
                wasRunning
        );
    }

    private static long sanitisedBase(long storedBase, long nowElapsed) {
        return WidgetTimeUtils.isStaleTimerBase(storedBase, nowElapsed) ? nowElapsed : storedBase;
    }

    private static long sanitisedPauseTime(long storedPauseTime, long nowElapsed) {
        return WidgetTimeUtils.isStalePauseTime(storedPauseTime, nowElapsed) ? 0L : storedPauseTime;
    }

    public long base() {
        return base;
    }

    public long pauseTime() {
        return pauseTime;
    }

    public boolean running() {
        return running;
    }

    /**
     * The value to hand to {@code RemoteViews.setChronometer}. A stopped {@code Chronometer} still
     * renders {@code elapsedRealtime() - base}, so a stored duration has to be converted back into
     * a base.
     */
    public long chronometerBase(long nowElapsed) {
        return running ? base : WidgetTimeUtils.pausedChronometerBase(nowElapsed, pauseTime);
    }

    /** The total the widget is currently showing, in milliseconds. */
    public long displayedMillis(long nowElapsed) {
        return running
                ? WidgetTimeUtils.elapsedSinceBase(nowElapsed, base)
                : pauseTime;
    }
}
