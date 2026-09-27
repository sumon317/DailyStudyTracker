package com.sumon.studytracker.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The provider paints the widget chrome and the RemoteViews factory paints the rows. Both resolve
 * through {@link WidgetTheme}, so these checks are what keep the two halves from drifting apart.
 */
public class WidgetThemeTest {

    @Test
    public void treatsAnythingButExplicitLightAsDark() {
        assertEquals(WidgetTheme.DARK, WidgetTheme.normalize(0));
        assertEquals(WidgetTheme.LIGHT, WidgetTheme.normalize(1));
        assertEquals(WidgetTheme.DARK, WidgetTheme.normalize(2));
        assertEquals(WidgetTheme.DARK, WidgetTheme.normalize(-1));
        assertFalse(WidgetTheme.isLight(2));
        assertTrue(WidgetTheme.isLight(1));
    }

    @Test
    public void toggleFlipsAndIsItsOwnInverse() {
        assertEquals(WidgetTheme.LIGHT, WidgetTheme.toggle(WidgetTheme.DARK));
        assertEquals(WidgetTheme.DARK, WidgetTheme.toggle(WidgetTheme.LIGHT));
        assertEquals(WidgetTheme.DARK, WidgetTheme.toggle(WidgetTheme.toggle(WidgetTheme.DARK)));
        assertEquals(WidgetTheme.LIGHT, WidgetTheme.toggle(WidgetTheme.toggle(WidgetTheme.LIGHT)));
    }

    @Test
    public void toggleIsIdempotentAcrossFourInvocations() {
        int theme = WidgetTheme.DARK;
        for (int index = 0; index < 4; index++) {
            theme = WidgetTheme.toggle(theme);
        }
        assertEquals(WidgetTheme.DARK, theme);
    }

    @Test
    public void glyphAdvertisesTheThemeThatWouldBeSelectedNext() {
        // Dark shows a moon to switch to light, light shows a sun to switch back to dark.
        assertEquals("\u25D0", WidgetTheme.themeButtonGlyph(WidgetTheme.DARK));
        assertEquals("\u2600", WidgetTheme.themeButtonGlyph(WidgetTheme.LIGHT));
    }

    @Test
    public void everyPaletteEntryDiffersBetweenThemes() {
        assertNotEquals(WidgetTheme.timerText(WidgetTheme.DARK), WidgetTheme.timerText(WidgetTheme.LIGHT));
        assertNotEquals(
                WidgetTheme.themeButtonText(WidgetTheme.DARK),
                WidgetTheme.themeButtonText(WidgetTheme.LIGHT)
        );
        assertNotEquals(WidgetTheme.subjectName(WidgetTheme.DARK), WidgetTheme.subjectName(WidgetTheme.LIGHT));
        assertNotEquals(WidgetTheme.subjectTime(WidgetTheme.DARK), WidgetTheme.subjectTime(WidgetTheme.LIGHT));
        assertNotEquals(WidgetTheme.subjectKpi(WidgetTheme.DARK), WidgetTheme.subjectKpi(WidgetTheme.LIGHT));
    }

    @Test
    public void opaquePaletteEntriesAreFullyOpaque() {
        // The widget row background is now a drawable, but the text colours are still plain
        // alpha-carrying ints, and a transparent one would be invisible on the host background.
        int[] colors = {
                WidgetTheme.timerText(WidgetTheme.DARK),
                WidgetTheme.timerText(WidgetTheme.LIGHT),
                WidgetTheme.subjectName(WidgetTheme.DARK),
                WidgetTheme.subjectName(WidgetTheme.LIGHT),
                WidgetTheme.subjectTime(WidgetTheme.DARK),
                WidgetTheme.subjectTime(WidgetTheme.LIGHT),
                WidgetTheme.subjectKpi(WidgetTheme.DARK),
                WidgetTheme.subjectKpi(WidgetTheme.LIGHT),
        };
        for (int color : colors) {
            int alpha = (color >>> 24) & 0xFF;
            assertEquals("colour is not opaque: " + Integer.toHexString(color), 0xFF, alpha);
        }
    }

    @Test
    public void lightThemeUsesDarkInkAndDarkThemeUsesLightInk() {
        assertEquals(0xFF0F172A, WidgetTheme.subjectName(WidgetTheme.LIGHT));
        assertEquals(0xFFFFFFFF, WidgetTheme.subjectName(WidgetTheme.DARK));
        assertEquals(0xFF4F46E5, WidgetTheme.subjectTime(WidgetTheme.LIGHT));
        assertEquals(0xFF818CF8, WidgetTheme.subjectTime(WidgetTheme.DARK));
        assertEquals(0xFF475569, WidgetTheme.subjectKpi(WidgetTheme.LIGHT));
        assertEquals(0xFFCBD5E1, WidgetTheme.subjectKpi(WidgetTheme.DARK));
        assertEquals(0xFF0F172A, WidgetTheme.timerText(WidgetTheme.LIGHT));
        assertEquals(0xFFE2E8F0, WidgetTheme.timerText(WidgetTheme.DARK));
    }
}
