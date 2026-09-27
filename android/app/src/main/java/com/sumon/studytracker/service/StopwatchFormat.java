package com.sumon.studytracker.service;

import java.util.Locale;

/**
 * Elapsed-time arithmetic and rendering for the stopwatch notification, kept free of Android
 * framework state so that they can be covered by JVM unit tests.
 */
final class StopwatchFormat {

    static final long SECOND_MILLIS = 1_000L;
    static final long MINUTE_MILLIS = 60L * SECOND_MILLIS;
    static final long HOUR_MILLIS = 60L * MINUTE_MILLIS;

    private StopwatchFormat() {
    }

    /**
     * {@code HH:MM:SS}. Hours are not wrapped at 24, because a study session that runs past
     * midnight is still one session, and the {@code %02d} only pads rather than truncates.
     */
    static String elapsedText(long elapsedMillis) {
        long total = Math.max(0L, elapsedMillis);
        long seconds = (total / SECOND_MILLIS) % 60L;
        long minutes = (total / MINUTE_MILLIS) % 60L;
        long hours = total / HOUR_MILLIS;
        return String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, seconds);
    }
}
