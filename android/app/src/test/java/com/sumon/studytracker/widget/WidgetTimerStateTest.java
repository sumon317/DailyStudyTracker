package com.sumon.studytracker.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Covers the widget timer's start/pause/stop transitions and its reboot reconciliation. The three
 * button presses and the notification actions all land here, so these are the checks that a second
 * press cannot move the displayed total.
 */
public class WidgetTimerStateTest {

    private static final long BASE = 1_000L;

    @Test
    public void playStartsFromNowWhenNothingWasAccumulated() {
        WidgetTimerState state = WidgetTimerState.started(BASE, 0L, false, 60_000L);
        assertTrue(state.running());
        assertEquals(0L, state.displayedMillis(60_000L));
    }

    @Test
    public void playResumesFromTheAccumulatedTotal() {
        // 30 seconds banked while paused, resumed 120 seconds later: the widget must show 30, not 0.
        WidgetTimerState state = WidgetTimerState.started(BASE, 30_000L, false, 121_000L);
        assertTrue(state.running());
        assertEquals(30_000L, state.displayedMillis(121_000L));
    }

    @Test
    public void playOnAnAlreadyRunningTimerChangesNothing() {
        // Regression: re-deriving the base from pauseTime, which is 0 while running, would restart
        // the count at zero every time the play button was pressed again.
        WidgetTimerState stored = WidgetTimerState.of(5_000L, 0L, true);
        WidgetTimerState state = WidgetTimerState.started(
                stored.base(), stored.pauseTime(), stored.running(), 9_000L);
        assertEquals(5_000L, state.base());
        assertEquals(4_000L, state.displayedMillis(9_000L));
    }

    @Test
    public void playIsIdempotentAcrossRepeatedPresses() {
        WidgetTimerState first = WidgetTimerState.started(BASE, 30_000L, false, 121_000L);
        WidgetTimerState second = WidgetTimerState.started(
                first.base(), first.pauseTime(), first.running(), 121_000L);
        WidgetTimerState third = WidgetTimerState.started(
                second.base(), second.pauseTime(), second.running(), 121_000L);
        assertEquals(first.base(), second.base());
        assertEquals(second.base(), third.base());
        assertEquals(first.displayedMillis(500_000L), third.displayedMillis(500_000L));
    }

    @Test
    public void pauseFreezesTheRunningTotal() {
        WidgetTimerState state = WidgetTimerState.paused(BASE, 0L, true, 31_000L);
        assertFalse(state.running());
        assertEquals(30_000L, state.pauseTime());
        assertEquals(30_000L, state.displayedMillis(999_000_000L));
    }

    @Test
    public void pauseOnAnAlreadyStoppedTimerKeepsTheBankedTotal() {
        // Regression: recomputing pauseTime as now - base for a stopped timer would grow the total
        // with wall-clock time alone, so an app left open overnight would invent study hours.
        WidgetTimerState stored = WidgetTimerState.of(121_000L, 30_000L, false);
        WidgetTimerState state = WidgetTimerState.paused(
                stored.base(), stored.pauseTime(), stored.running(), 5_000_000L);
        assertFalse(state.running());
        assertEquals(30_000L, state.pauseTime());
        assertEquals(30_000L, state.displayedMillis(5_000_000L));
    }

    @Test
    public void pauseIsIdempotentAcrossRepeatedPresses() {
        WidgetTimerState first = WidgetTimerState.paused(BASE, 0L, true, 31_000L);
        WidgetTimerState second = WidgetTimerState.paused(
                first.base(), first.pauseTime(), first.running(), 31_000L);
        WidgetTimerState third = WidgetTimerState.paused(
                second.base(), second.pauseTime(), second.running(), 31_000L);
        assertEquals(first.pauseTime(), second.pauseTime());
        assertEquals(second.pauseTime(), third.pauseTime());
        assertEquals(first.base(), third.base());
    }

    @Test
    public void resetClearsTheTotalAndIsIdempotent() {
        WidgetTimerState first = WidgetTimerState.reset(70_000L);
        assertFalse(first.running());
        assertEquals(0L, first.pauseTime());
        assertEquals(0L, first.displayedMillis(70_000L));
        assertEquals(0L, first.displayedMillis(70_000L + 9_000_000_000L));

        // Pressing stop twice: the second press only re-anchors the base, and the total stays zero.
        WidgetTimerState running = WidgetTimerState.started(BASE, 0L, false, 100_000L);
        WidgetTimerState stopped = WidgetTimerState.reset(200_000L);
        WidgetTimerState again = WidgetTimerState.paused(
                stopped.base(), stopped.pauseTime(), stopped.running(), 300_000L);
        assertEquals(0L, again.pauseTime());
        assertEquals(0L, again.displayedMillis(300_000L));
        assertTrue(running.running());
    }

    @Test
    public void aFullCycleKeepsOneMonotonicTotal() {
        long now = BASE;
        WidgetTimerState state = WidgetTimerState.of(BASE, 0L, false);

        // Run for 30 seconds.
        state = WidgetTimerState.started(state.base(), state.pauseTime(), state.running(), now);
        now += 30_000L;
        assertEquals(30_000L, state.displayedMillis(now));

        // Pause.
        state = WidgetTimerState.paused(state.base(), state.pauseTime(), state.running(), now);
        assertEquals(30_000L, state.displayedMillis(now));

        // Idle for two minutes; the total must not move.
        now += 120_000L;
        assertEquals(30_000L, state.displayedMillis(now));

        // Resume and run for another two minutes.
        state = WidgetTimerState.started(state.base(), state.pauseTime(), state.running(), now);
        now += 120_000L;
        assertEquals(150_000L, state.displayedMillis(now));

        // Pause again: the same total, no gap and no lost second.
        state = WidgetTimerState.paused(state.base(), state.pauseTime(), state.running(), now);
        assertEquals(150_000L, state.pauseTime());
    }

    @Test
    public void aRunningTimerThatSurvivedARebootRestartsAtZero() {
        // 9 hours of uptime were stored as the base; the device rebooted and has been up a minute.
        long nowAfterReboot = 60_000L;
        WidgetTimerState state = WidgetTimerState.started(32_400_000L, 0L, true, nowAfterReboot);
        assertEquals(nowAfterReboot, state.base());
        assertEquals(0L, state.displayedMillis(nowAfterReboot));
        assertFalse(WidgetTimeUtils.isStaleTimerBase(state.base(), nowAfterReboot));
    }

    @Test
    public void aPausedTimerThatSurvivedARebootLosesItsBankedTotal() {
        long nowAfterReboot = 120_000L;
        WidgetTimerState state = WidgetTimerState.paused(
                121_000L, 3_600_000L, false, nowAfterReboot);
        assertEquals(0L, state.pauseTime());
        assertEquals(0L, state.displayedMillis(nowAfterReboot));
    }

    @Test
    public void reconcilingAStoredTripleResetsAfterAReboot() {
        // What a render does with whatever it finds: a base ahead of the clock is untrustworthy.
        WidgetTimerState state = WidgetTimerState.reconciled(9_000_000L, 0L, true, 1_000L);
        assertFalse(state.running());
        assertEquals(1_000L, state.base());
        assertEquals(0L, state.pauseTime());
    }

    @Test
    public void reconcilingAStoredTripleDropsAnImpossibleDuration() {
        // pauseTime is written as now - base, so one larger than the current boot clock is a
        // leftover from before a reboot even when the base itself still looks plausible.
        WidgetTimerState state = WidgetTimerState.reconciled(50_000L, 9_000_000L, false, 1_000_000L);
        assertEquals(50_000L, state.base());
        assertEquals(0L, state.pauseTime());
    }

    @Test
    public void reconcilingLeavesAHealthyRunningTimerUntouched() {
        WidgetTimerState state = WidgetTimerState.reconciled(5_000L, 0L, true, 9_000L);
        assertTrue(state.running());
        assertEquals(5_000L, state.base());
        assertEquals(4_000L, state.displayedMillis(9_000L));
    }

    @Test
    public void reconcilingAHealthyPausedTimerUntouched() {
        WidgetTimerState state = WidgetTimerState.reconciled(121_000L, 30_000L, false, 121_000L);
        assertFalse(state.running());
        assertEquals(30_000L, state.pauseTime());
        assertEquals(30_000L, state.displayedMillis(121_000L));
    }

    @Test
    public void theChronometerBaseRendersTheStoredTotal() {
        // A stopped Chronometer still renders elapsedRealtime - base, so the paused base has to be
        // re-derived from the accumulated duration on every render.
        long now = 3_600_000L;
        WidgetTimerState paused = WidgetTimerState.of(3_510_000L, 90_000L, false);
        assertEquals(90_000L, now - paused.chronometerBase(now));

        WidgetTimerState running = WidgetTimerState.of(3_000_000L, 0L, true);
        assertEquals(3_000_000L, running.chronometerBase(now));
        assertEquals(600_000L, running.displayedMillis(now));
    }

    @Test
    public void aStaleBaseNeverProducesADisplayedTotalBeforeIt() {
        // Every path has to end up at zero, never a negative total and never device uptime.
        for (long base : new long[]{0L, -1L, 9_000_000L, 32_400_000L}) {
            for (long now : new long[]{1L, 1_000L, 60_000L}) {
                for (boolean wasRunning : new boolean[]{true, false}) {
                    assertDisplayedNeverNegative(base, 0L, wasRunning, now, "started");
                    assertDisplayedNeverNegative(base, 999_999_999L, wasRunning, now, "paused");
                    assertDisplayedNeverNegative(base, 0L, wasRunning, now, "reconciled");
                }
            }
        }
    }

    private static void assertDisplayedNeverNegative(
            long base,
            long pauseTime,
            boolean wasRunning,
            long now,
            String transition
    ) {
        WidgetTimerState state;
        if ("started".equals(transition)) {
            state = WidgetTimerState.started(base, pauseTime, wasRunning, now);
        } else if ("paused".equals(transition)) {
            state = WidgetTimerState.paused(base, pauseTime, wasRunning, now);
        } else {
            state = WidgetTimerState.reconciled(base, pauseTime, wasRunning, now);
        }
        assertTrue(
                transition + " produced " + state.displayedMillis(now),
                state.displayedMillis(now) >= 0L
        );
        assertTrue(
                transition + " produced a chronometer base of " + state.chronometerBase(now),
                state.chronometerBase(now) > 0L
        );
        // Whatever the transition decided, the total it reports has to survive a render unchanged.
        assertEquals(state.displayedMillis(now), now - state.chronometerBase(now));
    }
}
