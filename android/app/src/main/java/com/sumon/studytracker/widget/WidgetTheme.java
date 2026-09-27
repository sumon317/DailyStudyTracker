package com.sumon.studytracker.widget;

/**
 * Widget palette. The provider paints the chrome and the RemoteViews factory paints the rows, so
 * the colours live in one place as plain ints; that keeps both ends in agreement and leaves the
 * class free of Android framework state so it can be unit tested on the JVM.
 *
 * <p>Drawables are not modelled here because they need {@code R}, which the unit tests do not load.
 */
final class WidgetTheme {

    static final int DARK = 0;
    static final int LIGHT = 1;

    private WidgetTheme() {
    }

    /** Anything that is not an explicit light selection is treated as dark. */
    static int normalize(int stored) {
        return stored == LIGHT ? LIGHT : DARK;
    }

    static boolean isLight(int stored) {
        return normalize(stored) == LIGHT;
    }

    static int toggle(int stored) {
        return isLight(stored) ? DARK : LIGHT;
    }

    static int timerText(int stored) {
        return isLight(stored) ? 0xFF0F172A : 0xFFE2E8F0;
    }

    static int themeButtonText(int stored) {
        return isLight(stored) ? 0xFF0F172A : 0xFFE2E8F0;
    }

    /** Sun glyph once the light theme is active, moon glyph while dark. */
    static String themeButtonGlyph(int stored) {
        return isLight(stored) ? "\u2600" : "\u25D0";
    }

    static int subjectName(int stored) {
        return isLight(stored) ? 0xFF0F172A : 0xFFFFFFFF;
    }

    static int subjectTime(int stored) {
        return isLight(stored) ? 0xFF4F46E5 : 0xFF818CF8;
    }

    static int subjectKpi(int stored) {
        return isLight(stored) ? 0xFF475569 : 0xFFCBD5E1;
    }
}
