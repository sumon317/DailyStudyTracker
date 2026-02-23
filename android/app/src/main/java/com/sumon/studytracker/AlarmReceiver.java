package com.sumon.studytracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;

public class AlarmReceiver extends BroadcastReceiver {
    private static final String TAG = "AlarmReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra("id", -1);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");

        Log.d(TAG, "AlarmReceiver fired for ID: " + id);

        // Grab a quick wake lock to ensure the CPU doesn't fall asleep before our
        // Activity starts
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                "DailyStudyTracker:AlarmReceiverWakeLock");
        wakeLock.acquire(10000); // Hold for max 10 seconds

        try {
            // Launch the full-screen Alarm Activity to wake up the user
            Intent alarmIntent = new Intent(context, AlarmActivity.class);
            alarmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            alarmIntent.putExtra("id", id);
            alarmIntent.putExtra("title", title != null ? title : "Time's Up!");
            alarmIntent.putExtra("body", body != null ? body : "Your scheduled time has finished.");

            context.startActivity(alarmIntent);

        } catch (Exception e) {
            Log.e(TAG, "Failed to launch AlarmActivity", e);
        } finally {
            if (wakeLock.isHeld()) {
                wakeLock.release();
            }
        }
    }
}
