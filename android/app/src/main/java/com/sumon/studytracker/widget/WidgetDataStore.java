package com.sumon.studytracker.widget;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Collections;
import java.util.GregorianCalendar;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

public final class WidgetDataStore {

    public static final String PREFS_NAME = "WidgetPrefs";
    static final String PREF_DATA = "data";
    static final String PREF_DATE = "date";
    /**
     * Last selected theme, used as the default for a widget that has never been toggled. The
     * authoritative value for a placed widget is {@code StudyWidgetProvider.PREF_THEME + id}.
     */
    static final String PREF_THEME = "current_theme";

    /**
     * Every preference key that exists once per placed widget, with the app widget id appended.
     * None of these prefixes is a prefix of another, which is what makes
     * {@link #parseWidgetId(String)} unambiguous.
     */
    private static final String[] PER_WIDGET_KEY_PREFIXES = {
            StudyWidgetProvider.PREF_BASE,
            StudyWidgetProvider.PREF_PAUSE_TIME,
            StudyWidgetProvider.PREF_RUNNING,
            StudyWidgetProvider.PREF_THEME,
    };

    /**
     * Ceiling on the published payload. The stored value is a single SharedPreferences string, so
     * every write rewrites and reparses the whole file; a generous but finite bound keeps a
     * malformed bridge payload from turning into a multi-megabyte synchronous disk write.
     */
    public static final int MAX_DATA_LENGTH = 512_000;

    private WidgetDataStore() {
    }

    static boolean isLeapYear(int year) {
        return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    }

    /** @return days in the given proleptic Gregorian month, or {@code 0} when the month is invalid. */
    static int daysInMonth(int year, int month) {
        switch (month) {
            case 1:
            case 3:
            case 5:
            case 7:
            case 8:
            case 10:
            case 12:
                return 31;
            case 4:
            case 6:
            case 9:
            case 11:
                return 30;
            case 2:
                return isLeapYear(year) ? 29 : 28;
            default:
                return 0;
        }
    }

    /**
     * Validates a {@code YYYY-MM-DD} key with plain proleptic Gregorian arithmetic.
     *
     * <p>This deliberately avoids {@code Calendar}: a lenient {@code Calendar} resolves an
     * impossible day such as {@code 2026-02-29} into the following month first, so comparing the
     * requested day against {@code getActualMaximum} silently accepts 30/31 April and 31 June. It
     * would also make the answer depend on the device locale calendar.
     */
    static boolean isValidDate(String value) {
        if (value == null || value.length() != 10) {
            return false;
        }
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (index == 4 || index == 7) {
                if (character != '-') {
                    return false;
                }
            } else if (character < '0' || character > '9') {
                return false;
            }
        }

        int year = Integer.parseInt(value.substring(0, 4));
        int month = Integer.parseInt(value.substring(5, 7));
        int day = Integer.parseInt(value.substring(8, 10));
        if (year < 1) {
            return false;
        }
        int maximum = daysInMonth(year, month);
        return maximum > 0 && day >= 1 && day <= maximum;
    }

    /**
     * The current local date as {@code YYYY-MM-DD}.
     *
     * <p>{@code GregorianCalendar} is named explicitly: {@code Calendar.getInstance()} follows the
     * default locale's calendar system, and on a Buddhist locale such as {@code th-TH} it reports
     * the year as 2569. The web layer sends a proleptic Gregorian key, so the widget would then
     * never recognise the current day and would stay permanently empty.
     */
    static String todayKey() {
        GregorianCalendar calendar = new GregorianCalendar();
        return formatDateKey(
                calendar.get(GregorianCalendar.YEAR),
                calendar.get(GregorianCalendar.MONTH) + 1,
                calendar.get(GregorianCalendar.DAY_OF_MONTH)
        );
    }

    static String formatDateKey(int year, int month, int day) {
        return String.format(Locale.US, "%04d-%02d-%02d", year, month, day);
    }

    /** Minutes since local midnight, used to close a subject's planned window. */
    static int currentMinutesOfDay() {
        GregorianCalendar calendar = new GregorianCalendar();
        return calendar.get(GregorianCalendar.HOUR_OF_DAY) * 60
                + calendar.get(GregorianCalendar.MINUTE);
    }

    static boolean isToday(String value) {
        return todayKey().equals(value);
    }

    static boolean isCurrentDate(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return isToday(preferences.getString(PREF_DATE, null));
    }

    /**
     * Theme for a placed widget: its own toggle wins, otherwise the last theme chosen anywhere.
     * The provider and the row factory both resolve through here so the chrome and the list can
     * never disagree about which theme is active.
     */
    static int themeForWidget(Context context, int appWidgetId) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int stored = preferences.getInt(StudyWidgetProvider.PREF_THEME + appWidgetId,
                preferences.getInt(PREF_THEME, WidgetTheme.DARK));
        return WidgetTheme.normalize(stored);
    }

    /**
     * @return {@code true} for a key that belongs to exactly one placed widget. The bare prefixes
     *         are not per-widget keys: nothing writes them on its own.
     */
    static boolean isPerWidgetKey(String key) {
        if (key == null) {
            return false;
        }
        for (String prefix : PER_WIDGET_KEY_PREFIXES) {
            if (key.length() > prefix.length() && key.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @return the app widget id encoded in a per-widget key, or {@code null} when the key is not a
     *         per-widget key or carries a suffix that is not an id
     */
    static Integer parseWidgetId(String key) {
        if (key == null) {
            return null;
        }
        for (String prefix : PER_WIDGET_KEY_PREFIXES) {
            if (key.startsWith(prefix) && key.length() > prefix.length()) {
                try {
                    return Integer.valueOf(key.substring(prefix.length()));
                } catch (NumberFormatException exception) {
                    return null;
                }
            }
        }
        return null;
    }

    static Set<Integer> toIdSet(int[] appWidgetIds) {
        if (appWidgetIds == null || appWidgetIds.length == 0) {
            return Collections.emptySet();
        }
        Set<Integer> ids = new LinkedHashSet<>();
        for (int appWidgetId : appWidgetIds) {
            ids.add(appWidgetId);
        }
        return ids;
    }

    /**
     * Per-widget keys left behind by widgets that are no longer placed. An app widget id is never
     * reused, so a key that names no live widget is dead weight that would otherwise accumulate for
     * every widget the user has ever placed, and {@code onDeleted} is not guaranteed to arrive (a
     * killed host, or an uninstall that skips the callback).
     *
     * <p>Shared keys such as the published payload and the current theme are never returned.
     */
    static Set<String> staleWidgetKeys(Set<String> storedKeys, Set<Integer> liveWidgetIds) {
        Set<String> stale = new LinkedHashSet<>();
        if (storedKeys == null || liveWidgetIds == null) {
            return stale;
        }
        for (String key : storedKeys) {
            if (!isPerWidgetKey(key)) {
                continue;
            }
            Integer appWidgetId = parseWidgetId(key);
            if (appWidgetId == null || !liveWidgetIds.contains(appWidgetId)) {
                stale.add(key);
            }
        }
        return stale;
    }
}
