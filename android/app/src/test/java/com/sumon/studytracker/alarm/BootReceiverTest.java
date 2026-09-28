package com.sumon.studytracker.alarm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Covers the broadcast filter of the boot receiver and the PendingResult contract around the
 * background pass. The platform action constants are compile time constants and the
 * goAsync/PendingResult lifecycle needs framework objects, so both are exercised through the
 * pure helpers the receiver delegates to and nothing here touches the framework.
 */
public class BootReceiverTest {

    private static final String BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";
    private static final String MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";
    private static final String ALARM_ACTION = "com.sumon.studytracker.action.NATIVE_ALARM";

    @Test
    public void reconcilesAfterBootAndAfterAnAppUpdate() {
        assertTrue(BootReceiver.isReconcileAction(BOOT_COMPLETED));
        assertTrue(BootReceiver.isReconcileAction(MY_PACKAGE_REPLACED));
    }

    @Test
    public void ignoresEveryOtherAction() {
        // The receiver is manifest-registered, so it only sees these two in practice; the guard
        // exists so an explicit delivery of something else cannot spend the receiver's window.
        assertFalse(BootReceiver.isReconcileAction(null));
        assertFalse(BootReceiver.isReconcileAction(""));
        assertFalse(BootReceiver.isReconcileAction("android.intent.action.ACTION_POWER_CONNECTED"));
        assertFalse(BootReceiver.isReconcileAction("android.intent.action.QUICKBOOT_POWERON"));
        assertFalse(BootReceiver.isReconcileAction("com.sumon.studytracker.action.NATIVE_ALARM"));
    }

    @Test
    public void ignoresActionsThatOnlyDifferByCase() {
        // Intent actions are case sensitive, so a lookalike must not be treated as the real one.
        assertFalse(BootReceiver.isReconcileAction("android.intent.action.boot_completed"));
        assertFalse(BootReceiver.isReconcileAction("Android.intent.action.BOOT_COMPLETED"));
    }

    @Test
    public void aRejectedSubmissionStillFinishesTheBroadcast() {
        // goAsync() was already called, so the platform is holding the broadcast open. A
        // rejection path that returned without finish() would leave it held until the platform
        // force-finishes it at the end of the receiver window, which is the ANR this guards.
        assertTrue(BootReceiver.mustFinishAfterRejection());
    }

    @Test
    public void theAlarmBroadcastNeverTriggersABootReconcile() {
        // The alarm receiver posts under its own action. If that action reached the boot
        // receiver, every firing would spend a full reconcile pass re-arming the whole store.
        assertFalse(BootReceiver.isReconcileAction(ALARM_ACTION));
        // And the reverse: the boot actions must not be mistaken for the alarm.
        assertFalse(BOOT_COMPLETED.equals(ALARM_ACTION));
        assertFalse(MY_PACKAGE_REPLACED.equals(ALARM_ACTION));
    }

    @Test
    public void onlyTheTwoManifestRegisteredActionsReconcile() {
        // The manifest registers the receiver for exactly these two. Anything else would be an
        // explicit delivery, and reconciling on an unrelated broadcast would re-arm the store
        // at moments the app has no reason to touch it.
        int accepted = 0;
        for (String action : new String[]{
                BOOT_COMPLETED,
                MY_PACKAGE_REPLACED,
                "android.intent.action.LOCKED_BOOT_COMPLETED",
                "android.intent.action.USER_PRESENT",
                "android.intent.action.TIME_SET",
                "android.intent.action.TIMEZONE_CHANGED",
                ALARM_ACTION,
                "",
        }) {
            if (BootReceiver.isReconcileAction(action)) {
                accepted++;
            }
        }
        assertEquals(2, accepted);
    }
}
