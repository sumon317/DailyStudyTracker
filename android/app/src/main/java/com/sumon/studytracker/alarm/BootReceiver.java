package com.sumon.studytracker.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;

public final class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";

    /**
     * One daemon thread for the whole process, so a boot and an update broadcast arriving
     * together cannot interleave two passes over the alarm store.
     */
    private static final ExecutorService RECONCILER = Executors.newSingleThreadExecutor(
            new ThreadFactory() {
                @Override
                public Thread newThread(Runnable runnable) {
                    Thread thread = new Thread(runnable, "NativeAlarmReconciler");
                    thread.setDaemon(true);
                    return thread;
                }
            }
    );

    /**
     * The broadcasts that mean "the system forgot every alarm this app had armed". Anything
     * else is ignored, so an explicit delivery of some other action cannot trigger a pass.
     * Exposed for tests because the platform constants are not usable off-device.
     */
    static boolean isReconcileAction(String action) {
        return Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
    }

    /**
     * Whether a rejected submission still has to finish the broadcast.
     *
     * <p>{@link #onReceive} calls {@code goAsync()} before submitting, so the broadcast is held
     * open until {@code PendingResult.finish()} runs. If the submission is rejected that call
     * never comes from the worker, and an unfinished PendingResult is held open by the platform
     * until it is force-finished at the end of the receiver's execution window - which counts
     * against that window and can surface as an ANR. So the rejection path has to finish it
     * itself, and the work is simply dropped.
     *
     * <p>Exposed as a pure predicate because {@code goAsync} and {@code PendingResult} are
     * framework objects that cannot be constructed on a desktop JVM.
     */
    static boolean mustFinishAfterRejection() {
        return true;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        if (!isReconcileAction(intent.getAction())) {
            return;
        }

        final Context applicationContext = context.getApplicationContext() == null
                ? context
                : context.getApplicationContext();

        // Reconciling reads the persisted store (the first touch of SharedPreferences loads it
        // off disk) and then makes one AlarmManager call per alarm. Done inline that blocks the
        // main thread inside the receiver's execution window, so the work moves to a background
        // thread and goAsync() holds the broadcast open until finish() runs. The receiver window
        // is finite (about ten seconds), and 64 alarms is a few hundred binder calls, so the
        // single reconciler thread has ample headroom.
        final PendingResult pendingResult = goAsync();
        try {
            RECONCILER.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        NativeAlarmPlugin.reconcilePersistedAlarms(applicationContext);
                    } catch (Exception exception) {
                        Log.e(TAG, "Alarm reconciliation failed ("
                                + exception.getClass().getSimpleName() + ")");
                    } finally {
                        pendingResult.finish();
                    }
                }
            });
        } catch (RejectedExecutionException exception) {
            // Leaving the PendingResult unfinished holds the broadcast open until the platform
            // force-finishes it, which counts against the receiver's execution window and
            // can surface as an ANR. Failing the pass outright is the better outcome.
            Log.e(TAG, "Alarm reconciliation could not be scheduled");
            if (mustFinishAfterRejection()) {
                pendingResult.finish();
            }
        }
    }
}
