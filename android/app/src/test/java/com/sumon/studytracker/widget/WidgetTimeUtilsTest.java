package com.sumon.studytracker.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * JVM-only coverage for the pure widget helpers. Nothing here touches the Android framework, so
 * the whole class runs on a plain JVM unit test task.
 */
public class WidgetTimeUtilsTest {

    @Test
    public void acceptsFreshTimerBase() {
        assertFalse(WidgetTimeUtils.isStaleTimerBase(5_000L, 10_000L));
        assertFalse(WidgetTimeUtils.isStaleTimerBase(10_000L, 10_000L));
    }

    @Test
    public void rejectsBaseFromBeforeReboot() {
        // elapsedRealtime restarts at 0 after a reboot while the stored base survives.
        assertTrue(WidgetTimeUtils.isStaleTimerBase(9_000_000L, 1_000L));
    }

    @Test
    public void rejectsMissingTimerBase() {
        assertTrue(WidgetTimeUtils.isStaleTimerBase(0L, 10_000L));
        assertTrue(WidgetTimeUtils.isStaleTimerBase(-1L, 10_000L));
    }

    @Test
    public void pauseTimeFreezesTheAccumulatedDuration() {
        assertEquals(4_000L, WidgetTimeUtils.pauseTimeFor(6_000L, 10_000L));
    }

    @Test
    public void pauseTimeDropsARebootStaleBase() {
        // A stale base must not turn into invented study time: "time since the base" after a
        // reboot is device uptime, not the duration the user actually studied.
        assertEquals(0L, WidgetTimeUtils.pauseTimeFor(9_000_000L, 1_000L));
        assertEquals(0L, WidgetTimeUtils.pauseTimeFor(0L, 5_000L));
    }

    @Test
    public void resumeKeepsTheAccumulatedTotal() {
        long now = 10_000L;
        long pauseTime = 4_000L;
        long base = WidgetTimeUtils.baseForResume(pauseTime, now);
        // Resuming two seconds later must show the four paused seconds plus the two elapsed.
        assertEquals(6_000L, now + 2_000L - base);
    }

    @Test
    public void resumeBaseIsNeverMissingOrInTheFuture() {
        // A huge stale pauseTime would otherwise push the base to zero or negative, which the
        // staleness check would then discard and silently restart the timer.
        long now = 1_000L;
        long base = WidgetTimeUtils.baseForResume(50_000L, now);
        assertFalse(WidgetTimeUtils.isStaleTimerBase(base, now));
        assertEquals(now, base);
    }

    @Test
    public void resumeBaseIgnoresNegativePauseTime() {
        long now = 10_000L;
        assertEquals(now, WidgetTimeUtils.baseForResume(-5_000L, now));
    }

    @Test
    public void flagsPauseDurationsThatOutlivedTheBootClock() {
        // pauseTime is written as now - base, so it can never exceed the clock it was written
        // against. Anything larger means the device rebooted underneath a paused timer.
        assertFalse(WidgetTimeUtils.isStalePauseTime(90_000L, 1_000_000L));
        assertFalse(WidgetTimeUtils.isStalePauseTime(90_000L, 90_000L));
        assertTrue(WidgetTimeUtils.isStalePauseTime(90_000L, 1_000L));
        assertTrue(WidgetTimeUtils.isStalePauseTime(-1L, 1_000L));
        assertFalse(WidgetTimeUtils.isStalePauseTime(0L, 1_000L));
    }

    @Test
    public void pausedChronometerRendersTheAccumulatedDuration() {
        // Regression: RemoteViews.setChronometer was handed the stored duration as if it were a
        // base, so a paused widget displayed the device uptime (elapsedRealtime - pauseTime).
        long now = 3_600_000L;
        long pauseTime = 90_000L;
        long base = WidgetTimeUtils.pausedChronometerBase(now, pauseTime);
        assertEquals(pauseTime, now - base);
    }

    @Test
    public void pausedChronometerShowsZeroAfterReset() {
        long now = 3_600_000L;
        long base = WidgetTimeUtils.pausedChronometerBase(now, 0L);
        assertEquals(0L, now - base);
    }

    @Test
    public void parsesTimeOfDay() {
        assertEquals(0, WidgetTimeUtils.timeOfDayMinutes("00:00"));
        assertEquals(545, WidgetTimeUtils.timeOfDayMinutes("9:05"));
        assertEquals(600, WidgetTimeUtils.timeOfDayMinutes("10:00"));
        assertEquals(1439, WidgetTimeUtils.timeOfDayMinutes("23:59"));
    }

    @Test
    public void rejectsUnusableTimeValues() {
        assertEquals(-1, WidgetTimeUtils.timeOfDayMinutes(null));
        assertEquals(-1, WidgetTimeUtils.timeOfDayMinutes(""));
        assertEquals(-1, WidgetTimeUtils.timeOfDayMinutes("9"));
        assertEquals(-1, WidgetTimeUtils.timeOfDayMinutes(":05"));
        assertEquals(-1, WidgetTimeUtils.timeOfDayMinutes("09:"));
        assertEquals(-1, WidgetTimeUtils.timeOfDayMinutes("24:00"));
        assertEquals(-1, WidgetTimeUtils.timeOfDayMinutes("09:60"));
        assertEquals(-1, WidgetTimeUtils.timeOfDayMinutes("later"));
    }

    @Test
    public void parsesPlannedMinutes() {
        assertEquals(60.0, WidgetTimeUtils.plannedMinutes("60"), 0.0);
        assertEquals(0.5, WidgetTimeUtils.plannedMinutes("0.5"), 0.0);
        assertEquals(45.0, WidgetTimeUtils.plannedMinutes(" 45 "), 0.0);
    }

    @Test
    public void rejectsUnusablePlannedMinutes() {
        assertEquals(0.0, WidgetTimeUtils.plannedMinutes(null), 0.0);
        assertEquals(0.0, WidgetTimeUtils.plannedMinutes(""), 0.0);
        assertEquals(0.0, WidgetTimeUtils.plannedMinutes("-30"), 0.0);
        assertEquals(0.0, WidgetTimeUtils.plannedMinutes("0"), 0.0);
        assertEquals(0.0, WidgetTimeUtils.plannedMinutes("abc"), 0.0);
    }

    @Test
    public void rejectsNonFinitePlannedMinutes() {
        // Double.parseDouble("Infinity") succeeds, so without an explicit guard a single bad row
        // would get an infinite window and stay on the widget forever.
        assertEquals(0.0, WidgetTimeUtils.plannedMinutes("Infinity"), 0.0);
        assertEquals(0.0, WidgetTimeUtils.plannedMinutes("-Infinity"), 0.0);
        assertEquals(0.0, WidgetTimeUtils.plannedMinutes("NaN"), 0.0);
        assertEquals(0.0, WidgetTimeUtils.plannedMinutes("1e400"), 0.0);
    }

    @Test
    public void hidesSubjectsOnceTheirPlannedWindowClosed() {
        // 09:00 start, 60 planned minutes: hidden from 10:00 onwards.
        assertFalse(WidgetTimeUtils.isPastPlannedEnd(9 * 60, "09:00", "60"));
        assertFalse(WidgetTimeUtils.isPastPlannedEnd(9 * 60 + 59, "9:00", "60"));
        assertTrue(WidgetTimeUtils.isPastPlannedEnd(10 * 60, "09:00", "60"));
        assertTrue(WidgetTimeUtils.isPastPlannedEnd(10 * 60 + 1, "09:00", "60"));
    }

    @Test
    public void fractionalPlannedMinutesCloseTheWindowOnTime() {
        // 0.5 planned minutes from 09:00 must hide at 09:01, not 09:00, and never linger.
        assertFalse(WidgetTimeUtils.isPastPlannedEnd(9 * 60, "09:00", "0.5"));
        assertTrue(WidgetTimeUtils.isPastPlannedEnd(9 * 60 + 1, "09:00", "0.5"));
    }

    @Test
    public void keepsSubjectsWithoutAUsableStartTime() {
        assertFalse(WidgetTimeUtils.isPastPlannedEnd(23 * 60, "", "60"));
        assertFalse(WidgetTimeUtils.isPastPlannedEnd(23 * 60, null, "60"));
        assertFalse(WidgetTimeUtils.isPastPlannedEnd(23 * 60, "later", "60"));
        assertFalse(WidgetTimeUtils.isPastPlannedEnd(23 * 60, "25:00", "60"));
    }

    @Test
    public void ordersByTimeOfDayNotLexically() {
        assertTrue(WidgetTimeUtils.compareByStartTime("9:05", "10:00") < 0);
        assertTrue(WidgetTimeUtils.compareByStartTime("10:00", "9:05") > 0);
        assertEquals(0, WidgetTimeUtils.compareByStartTime("09:05", "9:05"));
    }

    @Test
    public void sortsMissingAndUnusableTimesLast() {
        // A missing or unparseable time makes that row the greater element, so it sorts last.
        assertTrue(WidgetTimeUtils.compareByStartTime("10:00", "") < 0);
        assertTrue(WidgetTimeUtils.compareByStartTime("10:00", null) < 0);
        assertTrue(WidgetTimeUtils.compareByStartTime("10:00", "later") < 0);
        assertTrue(WidgetTimeUtils.compareByStartTime("later", "10:00") > 0);
        assertTrue(WidgetTimeUtils.compareByStartTime("later", "whenever") != 0);
        assertEquals(0, WidgetTimeUtils.compareByStartTime("", ""));
    }

    @Test
    public void displaysTwelveHourTime() {
        assertEquals("9:05 AM", WidgetTimeUtils.displayTime("09:05"));
        assertEquals("12:00 AM", WidgetTimeUtils.displayTime("00:00"));
        assertEquals("12:00 PM", WidgetTimeUtils.displayTime("12:00"));
        assertEquals("12:30 PM", WidgetTimeUtils.displayTime("12:30"));
        assertEquals("11:59 PM", WidgetTimeUtils.displayTime("23:59"));
    }

    @Test
    public void displaysPlaceholderForMissingTime() {
        assertEquals("--:--", WidgetTimeUtils.displayTime(null));
        assertEquals("--:--", WidgetTimeUtils.displayTime(""));
    }

    @Test
    public void clampsUnparseableTimeForDisplay() {
        // A malformed day should still be visible, but never as a runaway widget row.
        assertEquals("whenever", WidgetTimeUtils.displayTime("whenever"));
        String padded = "0000000000000000extra";
        assertEquals(
                WidgetTimeUtils.MAX_TIME_LENGTH,
                WidgetTimeUtils.displayTime(padded).length()
        );
    }

    @Test
    public void clampsUntrustedText() {
        assertEquals("", WidgetTimeUtils.clampText(null, 8));
        assertEquals("abc", WidgetTimeUtils.clampText("abc", 8));
        assertEquals("abc", WidgetTimeUtils.clampText("abcdefghij", 3));
    }

    @Test
    public void stableSeedIsDeterministicAndNonNegative() {
        long first = WidgetTimeUtils.stableSeedId("Maths", "09:00");
        assertEquals(first, WidgetTimeUtils.stableSeedId("Maths", "09:00"));
        assertTrue(first >= 0L);
    }

    @Test
    public void stableSeedDoesNotDependOnListPosition() {
        // getItemId is fed the row, not its index, so the seed has to survive a reorder: that is
        // what lets the collection recycle views instead of rebinding everything.
        long before = WidgetTimeUtils.stableSeedId("Maths", "09:00");
        long after = WidgetTimeUtils.stableSeedId("Maths", "09:00");
        assertEquals(before, after);
        assertNotEquals(before, WidgetTimeUtils.stableSeedId("Physics", "09:00"));
        assertNotEquals(before, WidgetTimeUtils.stableSeedId("Maths", "10:00"));
    }

    @Test
    public void stableSeedStaysNonNegativeForEveryMissingField() {
        // The seed is handed to the collection as an id, and a negative one is reserved for
        // "there is no such row", so the mask has to hold even with nothing to hash.
        for (String[] pair : new String[][]{
                {null, null},
                {"", ""},
                {"Maths", null},
                {null, "09:00"},
        }) {
            assertTrue(
                    "seed went negative for " + java.util.Arrays.toString(pair),
                    WidgetTimeUtils.stableSeedId(pair[0], pair[1]) >= 0L
            );
        }
    }

    @Test
    public void stableSeedNeverReturnsTheReservedNegativeSentinel() {
        // -1 is the id the factory reports for a position that has no row.
        assertNotEquals(-1L, WidgetTimeUtils.stableSeedId(null, null));
    }

    /**
     * The start/pause/resume conversions, driven end to end. The transitions themselves are covered
     * by {@link WidgetTimerStateTest}; this pins the individual conversions the provider and the
     * service both lean on.
     */
    @Test
    public void startPauseResumeCycleKeepsOneMonotonicTotal() {
        long base = 1_000L;
        assertFalse(WidgetTimeUtils.isStaleTimerBase(base, 1_000L));

        // Run for 30 seconds, then pause.
        long pauseTime = WidgetTimeUtils.pauseTimeFor(base, 31_000L);
        assertEquals(30_000L, pauseTime);

        // Resume after two more minutes: the banked total is still on the clock, so the new base
        // sits 30 seconds in the past rather than at the moment play was pressed.
        long resumeAt = 151_000L;
        long resumedBase = WidgetTimeUtils.baseForResume(pauseTime, resumeAt);
        assertEquals(30_000L, resumeAt - resumedBase);
        assertEquals(32_000L, resumeAt + 2_000L - resumedBase);

        // Run on, then pause again: one continuous total, no gap and no lost second.
        assertEquals(300_000L, WidgetTimeUtils.pauseTimeFor(resumedBase, 421_000L));
    }

    @Test
    public void aPausedTotalDoesNotMoveWhileTheAppStaysOpen() {
        // The receiver keeps the stored duration when the timer is already stopped; recomputing
        // now - base for a stopped timer would grow the total with wall-clock time alone.
        long banked = WidgetTimeUtils.pauseTimeFor(1_000L, 31_000L);
        assertEquals(30_000L, banked);
        // Rendered much later, the paused base still resolves to exactly the banked duration.
        long muchLater = 9_000_000L;
        assertEquals(banked, muchLater - WidgetTimeUtils.pausedChronometerBase(muchLater, banked));
    }

    @Test
    public void aTimerThatSpansARebootRestartsAtZeroInsteadOfInventingUptime() {
        // 9 hours of uptime were stored as the base, then the device rebooted and has been up for
        // a minute. Trusting the base would report ~9 hours of study time that never happened.
        long nowAfterReboot = 60_000L;
        long storedBase = 32_400_000L;
        assertTrue(WidgetTimeUtils.isStaleTimerBase(storedBase, nowAfterReboot));
        assertEquals(0L, WidgetTimeUtils.pauseTimeFor(storedBase, nowAfterReboot));
        assertEquals(nowAfterReboot, WidgetTimeUtils.baseForResume(
                WidgetTimeUtils.pauseTimeFor(storedBase, nowAfterReboot), nowAfterReboot));
    }

    @Test
    public void aPausedTimerThatSpansARebootLosesItsAccumulatedTotal() {
        // Same detection through the pause duration, which is written as now - base and therefore
        // can never exceed the boot clock it was written against.
        long nowAfterReboot = 120_000L;
        long pauseTime = 3_600_000L;
        assertTrue(WidgetTimeUtils.isStalePauseTime(pauseTime, nowAfterReboot));
        assertEquals(
                nowAfterReboot,
                WidgetTimeUtils.baseForResume(
                        WidgetTimeUtils.isStalePauseTime(pauseTime, nowAfterReboot) ? 0L : pauseTime,
                        nowAfterReboot
                )
        );
    }

    @Test
    public void aRunningTotalIsNeverNegative() {
        assertEquals(4_000L, WidgetTimeUtils.elapsedSinceBase(10_000L, 6_000L));
        assertEquals(0L, WidgetTimeUtils.elapsedSinceBase(10_000L, 10_000L));
        // A base ahead of the clock can only be a reboot leftover. The staleness check is what
        // turns that into a reset, so this helper only has to refuse to report a negative span.
        assertEquals(0L, WidgetTimeUtils.elapsedSinceBase(1_000L, 9_000_000L));
        assertTrue(WidgetTimeUtils.isStaleTimerBase(0L, 1_000L));
    }

    @Test
    public void theRenderedBoundsArePositiveAndBounded() {
        // These caps are what stop a malformed bridge payload from producing a runaway widget row.
        assertTrue(WidgetTimeUtils.MAX_ITEMS > 0);
        assertTrue(WidgetTimeUtils.MAX_NAME_LENGTH > 0);
        assertTrue(WidgetTimeUtils.MAX_TIME_LENGTH > 0);
        assertTrue(WidgetTimeUtils.MAX_MINUTES_LENGTH > 0);
        // A formatted 12-hour time has to survive the clamp that bounds it.
        assertTrue(WidgetTimeUtils.MAX_TIME_LENGTH >= "12:59 PM".length());
    }

    @Test
    public void everyRenderedValueFitsInsideTheDeclaredClamp() {
        // A row longer than the widget can draw would push the KPI text off the home screen, so
        // every string that reaches a TextView is bounded twice: once here, once by the layout.
        String name = "Mathematics and Computer Science and Further Mathematics and Statistics";
        assertTrue(name.length() > WidgetTimeUtils.MAX_NAME_LENGTH);
        assertEquals(WidgetTimeUtils.MAX_NAME_LENGTH, WidgetTimeUtils.clampText(name, WidgetTimeUtils.MAX_NAME_LENGTH).length());

        String numbers = WidgetTimeUtils.clampText("1234.5678901234", WidgetTimeUtils.MAX_MINUTES_LENGTH)
                + "/" + WidgetTimeUtils.clampText("1234.5678901234", WidgetTimeUtils.MAX_MINUTES_LENGTH)
                + " min";
        assertEquals(
                2 * WidgetTimeUtils.MAX_MINUTES_LENGTH + "/".length() + " min".length(),
                numbers.length()
        );
    }
}
