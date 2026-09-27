package com.sumon.studytracker.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Covers the preferences cleanup performed when a widget is deleted. An app widget id is never
 * reused, so every {@code timer_*_<id>} key outlives the widget it belongs to unless something
 * removes it, and the shared keys next to them must survive.
 */
public class WidgetPrefsCleanupTest {

    private static Set<String> keys(String... values) {
        return new LinkedHashSet<>(Arrays.asList(values));
    }

    @Test
    public void recognisesThePerWidgetKeys() {
        assertTrue(WidgetDataStore.isPerWidgetKey("timer_base_7"));
        assertTrue(WidgetDataStore.isPerWidgetKey("timer_pause_time_7"));
        assertTrue(WidgetDataStore.isPerWidgetKey("timer_running_7"));
        assertTrue(WidgetDataStore.isPerWidgetKey("widget_theme_7"));
    }

    @Test
    public void sharedAndMalformedKeysAreNotPerWidgetKeys() {
        // The payload, the published day and the default theme all outlive any single widget.
        assertFalse(WidgetDataStore.isPerWidgetKey(null));
        assertFalse(WidgetDataStore.isPerWidgetKey(WidgetDataStore.PREF_DATA));
        assertFalse(WidgetDataStore.isPerWidgetKey(WidgetDataStore.PREF_DATE));
        assertFalse(WidgetDataStore.isPerWidgetKey(WidgetDataStore.PREF_THEME));
        // A bare prefix is never written on its own, so it is not an orphan to clean up.
        assertFalse(WidgetDataStore.isPerWidgetKey("timer_base_"));
        assertFalse(WidgetDataStore.isPerWidgetKey("widget_theme_"));
    }

    @Test
    public void readsTheWidgetIdOutOfAPerWidgetKey() {
        assertEquals(Integer.valueOf(7), WidgetDataStore.parseWidgetId("timer_base_7"));
        assertEquals(Integer.valueOf(0), WidgetDataStore.parseWidgetId("timer_running_0"));
        assertEquals(Integer.valueOf(12345), WidgetDataStore.parseWidgetId("widget_theme_12345"));
    }

    @Test
    public void aKeyWithNoNumericSuffixHasNoWidgetId() {
        // Nothing writes such a key, so if one ever appears it is safe to treat it as an orphan.
        assertNull(WidgetDataStore.parseWidgetId("timer_base_pending"));
        assertNull(WidgetDataStore.parseWidgetId(null));
        assertNull(WidgetDataStore.parseWidgetId("data"));
    }

    @Test
    public void collectsTheWidgetIds() {
        assertEquals(
                new HashSet<>(Arrays.asList(3, 9)),
                new HashSet<>(WidgetDataStore.toIdSet(new int[]{3, 9}))
        );
        // A duplicate id collapses rather than multiplying the remove calls.
        assertEquals(1, WidgetDataStore.toIdSet(new int[]{3, 3}).size());
        assertTrue(WidgetDataStore.toIdSet(null).isEmpty());
        assertTrue(WidgetDataStore.toIdSet(new int[0]).isEmpty());
    }

    @Test
    public void keepsTheKeysOfWidgetsThatAreStillPlaced() {
        Set<String> stored = keys(
                "timer_base_3", "timer_base_9", "timer_running_3", "widget_theme_9"
        );
        Set<String> stale = WidgetDataStore.staleWidgetKeys(stored, WidgetDataStore.toIdSet(new int[]{9}));
        assertEquals(keys("timer_base_3", "timer_running_3"), stale);
    }

    @Test
    public void dropsEveryKeyOfAWidgetThatIsGone() {
        // onDeleted is not guaranteed to arrive (a killed host, an uninstall that skips the
        // callback), so a later deletion has to mop up the ids it never heard about.
        Set<String> stored = keys(
                "timer_base_1", "timer_pause_time_1", "timer_running_1", "widget_theme_1"
        );
        Set<String> stale = WidgetDataStore.staleWidgetKeys(stored, WidgetDataStore.toIdSet(new int[]{2}));
        assertEquals(stored, stale);
    }

    @Test
    public void neverTouchesTheSharedKeys() {
        Set<String> stored = keys(
                WidgetDataStore.PREF_DATA,
                WidgetDataStore.PREF_DATE,
                WidgetDataStore.PREF_THEME
        );
        assertTrue(
                WidgetDataStore.staleWidgetKeys(stored, Collections.<Integer>emptySet()).isEmpty()
        );
    }

    @Test
    public void noWidgetsLeftMeansEveryPerWidgetKeyIsStale() {
        Set<String> stored = keys("timer_base_1", "widget_theme_2", "timer_running_3");
        assertEquals(stored, WidgetDataStore.staleWidgetKeys(stored, Collections.<Integer>emptySet()));
    }

    @Test
    public void malformedPerWidgetKeysAreCleanedUpToo() {
        Set<String> stored = keys("timer_base_pending", "timer_base_4");
        assertEquals(
                keys("timer_base_pending"),
                WidgetDataStore.staleWidgetKeys(stored, WidgetDataStore.toIdSet(new int[]{4}))
        );
    }

    @Test
    public void nothingToPruneIsANoOp() {
        assertTrue(
                WidgetDataStore.staleWidgetKeys(null, Collections.<Integer>emptySet()).isEmpty()
        );
        assertTrue(
                WidgetDataStore.staleWidgetKeys(keys("data"), null).isEmpty()
        );
        assertTrue(
                WidgetDataStore.staleWidgetKeys(
                        keys("timer_base_1"),
                        WidgetDataStore.toIdSet(new int[]{1})
                ).isEmpty()
        );
    }
}
