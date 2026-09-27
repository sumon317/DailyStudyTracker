package com.sumon.studytracker.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

public class AlarmReceiver extends BroadcastReceiver {

    private static final String TAG = "AlarmReceiver";

    private static final String EXTRA_ID = AlarmNotifications.EXTRA_ID;
    private static final String EXTRA_TITLE = AlarmNotifications.EXTRA_TITLE;
    private static final String EXTRA_BODY = AlarmNotifications.EXTRA_BODY;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        // A receiver runs on the main thread of the app process, so anything thrown here takes
        // the process down with it. Every step below is already guarded, and this is the
        // backstop that keeps an unexpected failure from becoming a crash.
        try {
            deliver(context, intent);
        } catch (Exception exception) {
            Log.e(TAG, "Alarm delivery failed (" + exception.getClass().getSimpleName() + ")");
        }
    }

    private static void deliver(Context context, Intent intent) {
        Integer id = NativeAlarmPlugin.exactId(extra(intent, EXTRA_ID));
        if (id == null) {
            // getIntExtra() would throw a ClassCastException on a non-numeric extra and kill the
            // process, and it would accept any int rather than the range the store uses. Reading
            // the raw object through the same gate as the bridge is both safe and consistent.
            Log.w(TAG, "Ignoring alarm with an invalid id");
            return;
        }

        // Re-sanitised on the way out as well as on the way in: the token is stored by the
        // system server, and a text extra that is larger than a notification row or a binder
        // transaction would be rejected (or silently clipped) at the far end.
        String title = NativeAlarmPlugin.sanitizeText(
                textExtra(intent, EXTRA_TITLE),
                NativeAlarmPlugin.FALLBACK_TITLE,
                NativeAlarmPlugin.MAX_TITLE_LENGTH
        );
        String body = NativeAlarmPlugin.sanitizeText(
                textExtra(intent, EXTRA_BODY),
                NativeAlarmPlugin.FALLBACK_BODY,
                NativeAlarmPlugin.MAX_BODY_LENGTH
        );

        // Posted first and unconditionally. A background activity start is dropped silently on
        // API 29+ (an exact alarm exempts a foreground service start, not an activity start),
        // so the notification is the only delivery path that survives the app being backgrounded.
        // AlarmActivity cancels it as soon as it takes over the sound.
        AlarmNotifications.post(context, id, title, body);

        // Fast path: with the app already in the foreground the activity is allowed and the
        // user sees the full-screen alarm immediately instead of a notification.
        try {
            Intent alarmIntent = new Intent(context, AlarmActivity.class);
            alarmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            // Unboxed on purpose: an Integer argument would bind to the Serializable overload of
            // putExtra rather than the int one, and the extra then has a different type from the
            // one the alarm token stores and the activity reads.
            alarmIntent.putExtra(EXTRA_ID, id.intValue());
            alarmIntent.putExtra(EXTRA_TITLE, title);
            alarmIntent.putExtra(EXTRA_BODY, body);
            context.startActivity(alarmIntent);
        } catch (Exception exception) {
            Log.e(TAG, "Alarm activity launch failed (" + exception.getClass().getSimpleName() + ")");
        }
    }

    private static Object extra(Intent intent, String key) {
        Bundle extras = intent.getExtras();
        return extras == null ? null : extras.get(key);
    }

    private static String textExtra(Intent intent, String key) {
        Object value = extra(intent, key);
        // getStringExtra() throws ClassCastException for a non-string extra, which is the same
        // crash the id read above avoids.
        return value instanceof String ? (String) value : null;
    }
}
