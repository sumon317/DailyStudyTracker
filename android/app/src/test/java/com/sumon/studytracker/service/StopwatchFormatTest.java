package com.sumon.studytracker.service;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * JVM-only coverage for the stopwatch notification's elapsed-time rendering. The service is a
 * framework class, so the arithmetic lives in {@link StopwatchFormat} where a desktop JVM can
 * reach it.
 */
public class StopwatchFormatTest {

    @Test
    public void rendersZeroForAFreshTimer() {
        assertEquals("00:00:00", StopwatchFormat.elapsedText(0L));
    }

    @Test
    public void rendersMinutesAndSeconds() {
        assertEquals("00:00:09", StopwatchFormat.elapsedText(9_000L));
        assertEquals("00:01:00", StopwatchFormat.elapsedText(60_000L));
        assertEquals("00:59:59", StopwatchFormat.elapsedText(59L * 60_000L + 59_000L));
    }

    @Test
    public void wrapsMinutesIntoHours() {
        assertEquals("01:00:00", StopwatchFormat.elapsedText(3_600_000L));
        assertEquals("02:03:04", StopwatchFormat.elapsedText(2L * 3_600_000L + 3L * 60_000L + 4_000L));
    }

    @Test
    public void doesNotWrapHoursAtADay() {
        // A study session that runs past midnight is still one session; wrapping to 00:00:00 would
        // make it look like it had just started.
        assertEquals("25:00:00", StopwatchFormat.elapsedText(25L * 3_600_000L));
        assertEquals("100:00:00", StopwatchFormat.elapsedText(100L * 3_600_000L));
    }

    @Test
    public void subSecondRemaindersAreTruncatedNotRounded() {
        // The widget's Chronometer rounds to the nearest second, but the notification counts whole
        // seconds, so a tick must never show a second early.
        assertEquals("00:00:00", StopwatchFormat.elapsedText(999L));
        assertEquals("00:00:01", StopwatchFormat.elapsedText(1_000L));
    }

    @Test
    public void aNegativeDurationReadsAsZero() {
        // Reachable whenever a base did not survive a reboot: elapsedRealtime restarts at zero
        // while the stored base does not, and inventing device uptime as study time is worse than
        // showing nothing.
        assertEquals("00:00:00", StopwatchFormat.elapsedText(-1L));
        assertEquals("00:00:00", StopwatchFormat.elapsedText(Long.MIN_VALUE));
    }

    @Test
    public void theUnitConstantsAgreeWithEachOther() {
        assertEquals(1_000L, StopwatchFormat.SECOND_MILLIS);
        assertEquals(60_000L, StopwatchFormat.MINUTE_MILLIS);
        assertEquals(3_600_000L, StopwatchFormat.HOUR_MILLIS);
        assertEquals(60L * StopwatchFormat.SECOND_MILLIS, StopwatchFormat.MINUTE_MILLIS);
        assertEquals(60L * StopwatchFormat.MINUTE_MILLIS, StopwatchFormat.HOUR_MILLIS);
    }

    @Test
    public void theLongestPossibleSessionStillRenders() {
        // No overflow at the top of the long range: the divisions are on longs, not ints, and the
        // hours field is the only one allowed to grow past two digits.
        String text = StopwatchFormat.elapsedText(Long.MAX_VALUE);
        String[] parts = text.split(":");
        assertEquals(3, parts.length);
        assertEquals(
                Long.MAX_VALUE / StopwatchFormat.HOUR_MILLIS,
                Long.parseLong(parts[0])
        );
        assertEquals((Long.MAX_VALUE / StopwatchFormat.MINUTE_MILLIS) % 60L, Long.parseLong(parts[1]));
        assertEquals((Long.MAX_VALUE / StopwatchFormat.SECOND_MILLIS) % 60L, Long.parseLong(parts[2]));
    }
}
