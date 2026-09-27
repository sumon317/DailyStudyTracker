package com.sumon.studytracker.alarm;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Covers the JVM-safe policy helpers behind the native alarm notification. Nothing here may
 * touch the Android framework, so the API-level rule is expressed as plain parameters.
 */
public class AlarmNotificationsTest {

    private static final int API_24 = 24;
    private static final int API_31 = 31;
    private static final int API_33 = 33;
    private static final int API_34 = 34;
    private static final int API_36 = 36;

    @Test
    public void notificationTagIsStableAndNamespacedPerAlarm() {
        assertEquals(AlarmNotifications.tagFor(7), AlarmNotifications.tagFor(7));
        assertNotEquals(AlarmNotifications.tagFor(7), AlarmNotifications.tagFor(8));
        assertEquals("native-alarm:7", AlarmNotifications.tagFor(7));
    }

    @Test
    public void notificationTagAcceptsTheWholeIdRange() {
        // The tag is a string, so it must not inherit the 31-bit alarm id bound.
        assertEquals("native-alarm:1", AlarmNotifications.tagFor(1));
        assertEquals("native-alarm:2147483647", AlarmNotifications.tagFor(Integer.MAX_VALUE));
    }

    @Test
    public void fullScreenIntentFollowsTheManifestBeforeApi34() {
        assertTrue(AlarmNotifications.allowsFullScreenIntent(API_24, false));
        assertTrue(AlarmNotifications.allowsFullScreenIntent(API_31, false));
        assertTrue(AlarmNotifications.allowsFullScreenIntent(API_33, false));
    }

    @Test
    public void fullScreenIntentIsGatedByTheRuntimeGrantFromApi34() {
        assertTrue(AlarmNotifications.allowsFullScreenIntent(API_34, true));
        assertTrue(AlarmNotifications.allowsFullScreenIntent(API_36, true));
        assertFalse(AlarmNotifications.allowsFullScreenIntent(API_34, false));
        assertFalse(AlarmNotifications.allowsFullScreenIntent(API_36, false));
    }

    @Test
    public void theAlarmStaysUnswipeableWhileAFullScreenIntentCanTakeOver() {
        // With the full-screen intent available the activity opens over the lock screen and
        // withdraws the notification, so the entry must not be dismissible in the meantime.
        assertTrue(AlarmNotifications.isStickyAlarmNotification(API_24, false));
        assertTrue(AlarmNotifications.isStickyAlarmNotification(API_31, false));
        assertTrue(AlarmNotifications.isStickyAlarmNotification(API_33, false));
        assertTrue(AlarmNotifications.isStickyAlarmNotification(API_34, true));
        assertTrue(AlarmNotifications.isStickyAlarmNotification(API_36, true));
    }

    @Test
    public void aDegradedAlarmStaysDismissible() {
        // Without the grant nothing takes the notification down once the background activity
        // start is dropped, so an ongoing entry would be a permanent shade row the user can only
        // clear by force-stopping the app.
        assertFalse(AlarmNotifications.isStickyAlarmNotification(API_34, false));
        assertFalse(AlarmNotifications.isStickyAlarmNotification(API_36, false));
    }

    @Test
    public void channelIdIsStable() {
        assertEquals("native_alarm", AlarmNotifications.CHANNEL_ID);
    }

    @Test
    public void theFullScreenIntentGateIsApi34() {
        // The rule and its tests must agree on one number. UPSIDE_DOWN_CAKE is a compile-time
        // constant, so reading it here touches no framework class on the JVM.
        assertEquals(34, AlarmNotifications.FULL_SCREEN_INTENT_GATE);
    }

    @Test
    public void theNotificationStaysSilentOnlyWhenTheActivityIsGuaranteedToTakeOver() {
        // AlarmActivity plays the alarm loop from the moment it starts, so on the path where it
        // definitely launches the notification must not add a second, overlapping ring.
        assertFalse(AlarmNotifications.shouldSoundWithNotification(API_24, false));
        assertFalse(AlarmNotifications.shouldSoundWithNotification(API_31, false));
        assertFalse(AlarmNotifications.shouldSoundWithNotification(API_33, false));
        assertFalse(AlarmNotifications.shouldSoundWithNotification(API_34, true));
        assertFalse(AlarmNotifications.shouldSoundWithNotification(API_36, true));
    }

    @Test
    public void aDegradedAlarmKeepsTheNotificationSound() {
        // Without the grant the background activity start is dropped, so the notification may be
        // the only thing that makes any noise. Muting it here would leave a silent alarm for a
        // user who never taps the shade entry.
        assertTrue(AlarmNotifications.shouldSoundWithNotification(API_34, false));
        assertTrue(AlarmNotifications.shouldSoundWithNotification(API_36, false));
    }

    @Test
    public void theExtraKeysAreTheOnesTheActivityAndReceiverRead() {
        // Three classes exchange these names across a PendingIntent the system server holds, so
        // a rename on one side that misses the others silently blanks the alarm's wording.
        assertEquals("id", AlarmNotifications.EXTRA_ID);
        assertEquals("title", AlarmNotifications.EXTRA_TITLE);
        assertEquals("body", AlarmNotifications.EXTRA_BODY);
        // Distinct, so one cannot shadow another.
        assertNotEquals(AlarmNotifications.EXTRA_ID, AlarmNotifications.EXTRA_TITLE);
        assertNotEquals(AlarmNotifications.EXTRA_TITLE, AlarmNotifications.EXTRA_BODY);
        assertNotEquals(AlarmNotifications.EXTRA_ID, AlarmNotifications.EXTRA_BODY);
    }

    @Test
    public void theNotificationTagCannotCollideWithTheBareIdsTheWebLayerPosts() {
        // The reminder notifications are posted under a bare numeric id, so the alarm's tag has
        // to be in a different namespace entirely, not merely a different number.
        for (int id : new int[]{1, 7, 42, Integer.MAX_VALUE}) {
            assertTrue(AlarmNotifications.tagFor(id).contains(":"));
        }
    }

    /**
     * The regression this file exists for. {@code AlarmActivity} is {@code singleTask}, so a
     * second alarm arriving while one is on screen is delivered to {@code onNewIntent} on the
     * same instance. That path used to overwrite {@code currentAlarmId} and then cancel a
     * notification keyed by the <em>new</em> id only, leaving the replaced alarm's notification
     * in the shade - and in sticky mode, which is exactly the mode the full-screen-intent grant
     * enables, that entry is ongoing with nothing left to dismiss it.
     */
    @Test
    public void aReplacedAlarmHasToWithdrawBothNotificationIds() {
        int[] ids = AlarmNotifications.notificationIdsToWithdraw(7, 9);
        assertArrayEquals(new int[]{7, 9}, ids);
    }

    @Test
    public void withdrawingIsIdempotentWhenTheSameAlarmIsRedelivered() {
        // CLEAR_TOP can re-deliver the same alarm into the existing instance. Cancelling it twice
        // is harmless but pointless, and the duplicate is what a caller would have to reason
        // about, so the second entry is dropped.
        int[] ids = AlarmNotifications.notificationIdsToWithdraw(7, 7);
        assertArrayEquals(new int[]{7}, ids);
        assertEquals(1, ids.length);
    }

    @Test
    public void everyWithdrawnIdPassesTheGateTheNotificationCancellerApplies() {
        // AlarmNotifications.cancel drops anything that is not a valid alarm id, so an id that
        // failed the gate here would mean the cancel was silently skipped and the very leak
        // this fixes would return. -1 is the activity's initial "no alarm yet" value and is the
        // one legitimate exception: there is no notification to withdraw for it.
        int[] idsUnderTest = {-1, 1, 7, Integer.MAX_VALUE};
        for (int replaced : idsUnderTest) {
            for (int incoming : idsUnderTest) {
                for (int id : AlarmNotifications.notificationIdsToWithdraw(replaced, incoming)) {
                    if (id != -1) {
                        assertTrue("id " + id + " must be cancellable",
                                NativeAlarmPlugin.isValidAlarmId(id));
                    }
                }
            }
        }
    }

    @Test
    public void theFirstAlarmOnAFreshActivityWithdrawsOnlyItself() {
        // currentAlarmId starts at -1, so the very first hand-over must not try to withdraw a
        // notification for an alarm that never fired. The -1 is still returned rather than
        // filtered here, because AlarmNotifications.cancel already ignores it, and keeping the
        // list symmetric is what makes the call site readable.
        int[] ids = AlarmNotifications.notificationIdsToWithdraw(-1, 7);
        assertArrayEquals(new int[]{-1, 7}, ids);
        assertFalse(NativeAlarmPlugin.isValidAlarmId(-1));
        assertTrue(NativeAlarmPlugin.isValidAlarmId(7));
    }

    @Test
    public void theReplacedIdIsWithdrawnBeforeTheInstanceForgetsIt() {
        // The call site reads currentAlarmId into a local before reassigning it. Simulating
        // that order here pins the bug: reading it afterwards yields the incoming id for both
        // cancels, which is the leak.
        int currentAlarmId = 7;
        int nextAlarmId = 9;

        int replacedAlarmId = currentAlarmId;
        currentAlarmId = nextAlarmId;

        // What the old code did: cancel(currentAlarmId) twice.
        int[] buggy = {currentAlarmId, currentAlarmId};
        // The replaced alarm's notification is never withdrawn.
        for (int id : buggy) {
            assertNotEquals(7, id);
        }
        // What the code does now, via the same order of reads.
        assertArrayEquals(
                new int[]{replacedAlarmId, currentAlarmId},
                AlarmNotifications.notificationIdsToWithdraw(replacedAlarmId, currentAlarmId)
        );
    }

    @Test
    public void theActivityCannotRingForAnIdTheStoreWouldRefuse() {
        // AlarmActivity only ever starts from a token the store or the receiver produced, and it
        // re-checks through the same gate. An id it accepts is therefore an id whose
        // notification tag and PendingIntent request code are both well defined, and no two of
        // those can collide on the same tag.
        int[] valid = {1, 2, 7, 12345, Integer.MAX_VALUE - 1, Integer.MAX_VALUE};
        for (int id : valid) {
            assertTrue(NativeAlarmPlugin.isValidAlarmId(id));
        }
        for (int i = 0; i < valid.length; i++) {
            for (int j = i + 1; j < valid.length; j++) {
                assertNotEquals(
                        AlarmNotifications.tagFor(valid[i]),
                        AlarmNotifications.tagFor(valid[j])
                );
            }
        }
    }
}
