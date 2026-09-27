package com.sumon.studytracker.widget;

import java.util.Locale;

/**
 * Time-only helpers for the widget, kept free of Android framework state so that they can be
 * covered by JVM unit tests.
 */
public final class WidgetTimeUtils {

    /**
     * Upper bound on the number of subjects a single widget will render, mirrored from
     * {@code MAX_WIDGET_ITEMS} in {@code src/services/widgetService.ts}.
     *
     * The web layer refuses to publish more than this, and the plugin refuses to accept more than
     * this, so both sides reject the same payload for the same reason. Truncating on one side
     * only - which is what this used to do - meant a day with more subjects than the cap silently
     * rendered a prefix, with nothing on either side saying so.
     */
    public static final int MAX_ITEMS = 200;

    /** Bounds on the strings handed to a widget {@code TextView}. */
    public static final int MAX_NAME_LENGTH = 60;
    public static final int MAX_TIME_LENGTH = 16;
    public static final int MAX_MINUTES_LENGTH = 12;

    private WidgetTimeUtils() {
    }

    /**
     * A persisted timer base is an {@code elapsedRealtime} value, and {@code elapsedRealtime} resets
     * to zero on reboot while the stored value survives. A base in the future therefore means the
     * device rebooted under a running timer, so the stored value can no longer be trusted.
     */
    public static boolean isStaleTimerBase(long storedBase, long nowElapsed) {
        return storedBase <= 0L || storedBase > nowElapsed;
    }

    /**
     * Elapsed time to keep on pause. A stale base is worth nothing: the device rebooted, so the
     * accumulated duration is unknown and reporting a large "time since the base" value would
     * invent study time that never happened.
     */
    public static long pauseTimeFor(long storedBase, long nowElapsed) {
        if (isStaleTimerBase(storedBase, nowElapsed)) {
            return 0L;
        }
        return Math.max(0L, nowElapsed - storedBase);
    }

    /**
     * Whether a stored pause duration can still be trusted.
     *
     * <p>{@code pauseTime} is written as {@code now - base}, so it can never exceed the
     * {@code elapsedRealtime} it was written against. A larger value therefore means the boot
     * clock was reset underneath it, and the accumulated duration is no longer real.
     */
    public static boolean isStalePauseTime(long pauseTime, long nowElapsed) {
        return pauseTime < 0L || pauseTime > nowElapsed;
    }

    /**
     * Base to persist when a paused timer resumes, so that the total keeps counting from the
     * already accumulated {@code pauseTime}. The result is always strictly positive, so a later
     * staleness check cannot mistake it for a missing base; a {@code pauseTime} too large for the
     * current boot clock collapses to {@code nowElapsed}, which restarts the count at zero.
     */
    public static long baseForResume(long pauseTime, long nowElapsed) {
        long base = nowElapsed - Math.max(0L, pauseTime);
        return base > 0L ? base : nowElapsed;
    }

    /**
     * Elapsed milliseconds of a running timer, never negative. A base ahead of the current clock can
     * only mean the device rebooted, and counting up from it would report device uptime as study
     * time, so that case reads as zero.
     */
    public static long elapsedSinceBase(long nowElapsed, long base) {
        return Math.max(0L, nowElapsed - base);
    }

    /**
     * Base to hand to {@code RemoteViews.setChronometer} for a paused timer.
     *
     * <p>{@code Chronometer} always renders {@code elapsedRealtime() - base}, including when it is
     * stopped, so a stored duration has to be converted back into a base. Passing the duration
     * itself would make the widget show the device uptime instead of the accumulated time.
     */
    public static long pausedChronometerBase(long nowElapsed, long pauseTime) {
        return baseForResume(pauseTime, nowElapsed);
    }

    /**
     * @return minutes since midnight, or {@code -1} when the value is not a usable {@code H:MM} or
     *         {@code HH:MM} time of day.
     */
    public static int timeOfDayMinutes(String time) {
        if (time == null) {
            return -1;
        }
        int separator = time.indexOf(':');
        if (separator <= 0 || separator == time.length() - 1) {
            return -1;
        }
        int hours;
        int minutes;
        try {
            hours = Integer.parseInt(time.substring(0, separator).trim());
            minutes = Integer.parseInt(time.substring(separator + 1).trim());
        } catch (NumberFormatException exception) {
            return -1;
        }
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return -1;
        }
        return hours * 60 + minutes;
    }

    /**
     * The web layer sends fractional planned minutes, so truncation here would silently keep
     * already-finished subjects visible. Non-finite input is rejected because
     * {@code Double.parseDouble("Infinity")} succeeds and would make a row immortal.
     */
    public static double plannedMinutes(String planned) {
        if (planned == null) {
            return 0.0;
        }
        try {
            double parsed = Double.parseDouble(planned.trim());
            return Double.isFinite(parsed) && parsed > 0.0 ? parsed : 0.0;
        } catch (NumberFormatException exception) {
            return 0.0;
        }
    }

    /**
     * A subject is hidden once its planned window has elapsed. Rows without a usable start time
     * have no window to close, so they stay visible and sort last.
     */
    public static boolean isPastPlannedEnd(int currentMinutes, String time, String planned) {
        int startMinutes = timeOfDayMinutes(time);
        if (startMinutes < 0) {
            return false;
        }
        return currentMinutes >= startMinutes + plannedMinutes(planned);
    }

    /**
     * Orders by actual time of day rather than lexically, so {@code "9:05"} sorts before
     * {@code "10:00"}. Unusable values sort last, and ties fall back to a deterministic comparison.
     */
    public static int compareByStartTime(String first, String second) {
        boolean firstMissing = first == null || first.isEmpty();
        boolean secondMissing = second == null || second.isEmpty();
        if (firstMissing && secondMissing) {
            return 0;
        }
        if (firstMissing) {
            return 1;
        }
        if (secondMissing) {
            return -1;
        }

        int firstMinutes = timeOfDayMinutes(first);
        int secondMinutes = timeOfDayMinutes(second);
        if (firstMinutes < 0 && secondMinutes < 0) {
            return first.compareTo(second);
        }
        if (firstMinutes < 0) {
            return 1;
        }
        if (secondMinutes < 0) {
            return -1;
        }
        return Integer.compare(firstMinutes, secondMinutes);
    }

    /**
     * Position-independent seed used when a row carries no usable numeric id, so a subject keeps
     * its id across reorders and the collection can recycle views correctly.
     */
    public static long stableSeedId(String name, String time) {
        long seed = 1125899906842597L;
        if (name != null) {
            seed = 31L * seed + name.hashCode();
        }
        if (time != null) {
            seed = 31L * seed + time.hashCode();
        }
        return seed & 0x7fffffffL;
    }

    /** Truncates untrusted JSON strings before they reach a widget {@code TextView}. */
    public static String clampText(String value, int maxLength) {
        if (value == null) {
            return "";
        }
        if (value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength);
    }

    /**
     * Renders a stored start time for display. Unparseable values are echoed back (clamped) so a
     * malformed day is visible in the widget rather than silently blank.
     */
    public static String displayTime(String time) {
        if (time == null || time.isEmpty()) {
            return "--:--";
        }
        int minutes = timeOfDayMinutes(time);
        if (minutes < 0) {
            return clampText(time, MAX_TIME_LENGTH);
        }
        int hour = minutes / 60;
        int minute = minutes % 60;
        String period = hour >= 12 ? "PM" : "AM";
        int displayHour = hour % 12;
        if (displayHour == 0) {
            displayHour = 12;
        }
        return String.format(Locale.US, "%d:%02d %s", displayHour, minute, period);
    }
}
