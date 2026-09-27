package com.sumon.studytracker.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import org.junit.Test;

import java.util.HashSet;
import java.util.Set;

/**
 * Covers the identity a widget button's {@code PendingIntent} is keyed by. The provider and the
 * stopwatch notification both build these buttons, and a {@code PendingIntent} is identified by the
 * request code <em>together with</em> the Intent's action/data/component, so anything that makes
 * two buttons collide would let {@code FLAG_UPDATE_CURRENT} rewrite one with the other's extras.
 */
public class WidgetActionReceiverTest {

    @Test
    public void requestCodesAreStableForTheSameWidgetAndAction() {
        int first = WidgetActionReceiver.requestCodeFor(
                7, WidgetActionReceiver.ACTION_TIMER_START);
        int second = WidgetActionReceiver.requestCodeFor(
                7, WidgetActionReceiver.ACTION_TIMER_START);
        assertEquals(first, second);
    }

    @Test
    public void requestCodesDifferPerAction() {
        Set<Integer> codes = new HashSet<>();
        for (String action : new String[]{
                WidgetActionReceiver.ACTION_TIMER_START,
                WidgetActionReceiver.ACTION_TIMER_PAUSE,
                WidgetActionReceiver.ACTION_TIMER_RESET,
                WidgetActionReceiver.ACTION_THEME_TOGGLE,
        }) {
            assertEquals(
                    "request code collision for " + action,
                    true,
                    codes.add(WidgetActionReceiver.requestCodeFor(7, action))
            );
        }
        assertEquals(4, codes.size());
    }

    @Test
    public void requestCodesDifferPerWidget() {
        assertNotEquals(
                WidgetActionReceiver.requestCodeFor(7, WidgetActionReceiver.ACTION_TIMER_START),
                WidgetActionReceiver.requestCodeFor(8, WidgetActionReceiver.ACTION_TIMER_START)
        );
    }

    @Test
    public void aNullActionIsHandledInsteadOfThrowing() {
        // Only reachable through an explicit call, but a request code that throws here would take
        // the whole broadcast down.
        assertEquals(31 * 7, WidgetActionReceiver.requestCodeFor(7, null));
    }

    @Test
    public void dataUrisAreStableForTheSameWidgetAndAction() {
        assertEquals(
                WidgetActionReceiver.actionDataUri(7, WidgetActionReceiver.ACTION_TIMER_PAUSE),
                WidgetActionReceiver.actionDataUri(7, WidgetActionReceiver.ACTION_TIMER_PAUSE)
        );
    }

    /**
     * The data URI is the second half of the PendingIntent key, so the request code and the URI
     * have to separate the same pairs: a collision on either one alone would merge two buttons.
     */
    @Test
    public void everyWidgetActionPairHasItsOwnIdentity() {
        Set<String> identities = new HashSet<>();
        for (int appWidgetId : new int[]{1, 2, 7, 42}) {
            for (String action : new String[]{
                    WidgetActionReceiver.ACTION_TIMER_START,
                    WidgetActionReceiver.ACTION_TIMER_PAUSE,
                    WidgetActionReceiver.ACTION_TIMER_RESET,
                    WidgetActionReceiver.ACTION_THEME_TOGGLE,
            }) {
                String identity = WidgetActionReceiver.requestCodeFor(appWidgetId, action)
                        + "|" + WidgetActionReceiver.actionDataUri(appWidgetId, action);
                assertEquals("identity collision for " + identity, true, identities.add(identity));
            }
        }
        assertEquals(16, identities.size());
    }

    @Test
    public void dataUrisNameTheWidgetAndTheAction() {
        // Uri.parse is lenient, so the rendering is pinned here: a "#" or "?" would truncate the
        // path and merge two buttons onto one PendingIntent.
        assertEquals(
                "studywidget://action/7/" + WidgetActionReceiver.ACTION_TIMER_START.hashCode(),
                WidgetActionReceiver.actionDataUri(7, WidgetActionReceiver.ACTION_TIMER_START)
        );
        assertEquals(
                "studywidget://action/0/" + WidgetActionReceiver.ACTION_TIMER_RESET.hashCode(),
                WidgetActionReceiver.actionDataUri(0, WidgetActionReceiver.ACTION_TIMER_RESET)
        );
        assertEquals(
                "studywidget://action/7/0",
                WidgetActionReceiver.actionDataUri(7, null)
        );
    }
}
