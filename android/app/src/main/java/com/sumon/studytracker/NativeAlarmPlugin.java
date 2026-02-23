package com.sumon.studytracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeAlarm")
public class NativeAlarmPlugin extends Plugin {

    private static final String TAG = "NativeAlarmPlugin";

    @PluginMethod
    public void scheduleAlarm(PluginCall call) {
        Integer id = call.getInt("id");
        Long time = call.getLong("time");
        String title = call.getString("title", "Alarm");
        String body = call.getString("body", "Time is up!");

        if (id == null || time == null) {
            call.reject("Must provide an id and a time (timestamp in ms)");
            return;
        }

        try {
            Context context = getContext();
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

            Intent intent = new Intent(context, AlarmReceiver.class);
            intent.putExtra("id", id);
            intent.putExtra("title", title);
            intent.putExtra("body", body);

            // Use FLAG_UPDATE_CURRENT combined with FLAG_IMMUTABLE
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent pendingIntent = PendingIntent.getBroadcast(context, id, intent, flags);

            // Cancel any existing alarm first
            alarmManager.cancel(pendingIntent);

            // Use the absolute highest priority alarm method available.
            // setAlarmClock guarantees execution and shows an alarm icon in the status bar.
            AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(time, pendingIntent);
            alarmManager.setAlarmClock(info, pendingIntent);

            Log.d(TAG, "Native Alarm scheduled successfully for id: " + id + " at " + time);
            call.resolve();

        } catch (Exception e) {
            Log.e(TAG, "Error scheduling alarm", e);
            call.reject("Error scheduling alarm: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelAlarm(PluginCall call) {
        Integer id = call.getInt("id");

        if (id == null) {
            call.reject("Must provide an id");
            return;
        }

        try {
            Context context = getContext();
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

            Intent intent = new Intent(context, AlarmReceiver.class);

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent pendingIntent = PendingIntent.getBroadcast(context, id, intent, flags);
            alarmManager.cancel(pendingIntent);
            pendingIntent.cancel(); // Also cancel the pending intent itself

            // Also send a broadcast to finish any currently ringing alarm activity for this
            // ID
            Intent stopIntent = new Intent(AlarmActivity.ACTION_STOP_ALARM);
            stopIntent.putExtra("id", id);
            context.sendBroadcast(stopIntent);

            Log.d(TAG, "Native Alarm cancelled successfully for id: " + id);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error cancelling alarm", e);
            call.reject("Error cancelling alarm: " + e.getMessage());
        }
    }
}
