package com.sumon.studytracker.alarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.sumon.studytracker.R;

/**
 * Ringing notification for a fired alarm.
 *
 * <p>Since Android 10 (API 29) an app in the background may not start an activity, and an
 * exact alarm only exempts a foreground <em>service</em> start, not an activity start. The
 * direct {@code startActivity} in {@link AlarmReceiver} is therefore dropped whenever the
 * app is not in the foreground, which would leave the alarm completely silent. Posting a
 * high-importance notification closes that gap: a tap reaches {@link AlarmActivity} through a
 * system-sent PendingIntent, and a full-screen intent launches it outright while the device is
 * locked. {@link AlarmActivity} cancels the notification as soon as it takes over the sound.
 */
final class AlarmNotifications {

    static final String CHANNEL_ID = "native_alarm";

    /**
     * Tags namespace the notification slot completely, so a native alarm can never replace a
     * reminder notification that the web layer posted under a bare id.
     */
    private static final String TAG_PREFIX = "native-alarm:";

    /**
     * The extra keys shared with {@link AlarmActivity} and {@link AlarmReceiver}. Spelled once
     * so a renamed key cannot leave one of the three reading a name the others no longer write.
     */
    static final String EXTRA_ID = "id";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";

    private static final int NOTIFICATION_ID = 1;
    private static final String LOG_TAG = "AlarmNotifications";

    /**
     * The pattern handed to {@code setVibrate} to keep the notification itself silent. Sharing
     * one zero-length array is safe precisely because there is nothing in it to mutate - unlike
     * the alarm pattern, which has to be copied per caller.
     */
    private static final long[] NO_VIBRATION = new long[0];

    private AlarmNotifications() {
    }

    static String tagFor(int alarmId) {
        return TAG_PREFIX + alarmId;
    }

    /**
     * The API level at which the full-screen-intent capability stopped following the manifest
     * declaration. Up to API 33 holding {@code USE_FULL_SCREEN_INTENT} was enough; from API 34
     * the grant is decided per app and has to be queried, and {@code
     * NotificationManager.canUseFullScreenIntent()} is the only way to ask. Exposed so the rule
     * and its tests share one number instead of repeating the literal.
     */
    static final int FULL_SCREEN_INTENT_GATE = Build.VERSION_CODES.UPSIDE_DOWN_CAKE;

    /**
     * A full-screen intent is only honoured while the platform grants
     * {@code USE_FULL_SCREEN_INTENT}. Up to API 33 the grant follows the manifest declaration;
     * from API 34 it can be withheld or revoked per app, so the capability has to be queried
     * and the notification degrades to a heads-up alert when it is unavailable.
     *
     * <p>The runtime flag is only meaningful at or above {@link #FULL_SCREEN_INTENT_GATE}, which
     * is the same condition {@code post} uses to decide whether it can call
     * {@code canUseFullScreenIntent()} at all, so a pre-34 caller passing a stale
     * {@code true} is ignored rather than trusted.
     */
    static boolean allowsFullScreenIntent(int sdkInt, boolean canUseFullScreenIntent) {
        return sdkInt < FULL_SCREEN_INTENT_GATE || canUseFullScreenIntent;
    }

    /**
     * Whether the alarm notification should refuse to be swiped away.
     *
     * <p>An ongoing notification is the right shape for an alarm that is about to take over the
     * screen: the user is not meant to dismiss the ringing alarm from the shade. But if the
     * full-screen intent cannot be used there is nothing left to take the notification down —
     * the activity start from the broadcast is dropped in the background — and an ongoing
     * notification is no longer dismissible, so a user who never taps it would be left with a
     * permanent shade entry that only a force-stop clears. In that degraded mode the
     * notification stays dismissible, and heads-up importance still surfaces it.
     */
    static boolean isStickyAlarmNotification(int sdkInt, boolean canUseFullScreenIntent) {
        return allowsFullScreenIntent(sdkInt, canUseFullScreenIntent);
    }

    /**
     * Whether the ringing notification should make its own sound.
     *
     * <p>{@link AlarmActivity} plays the alarm loop from the moment it starts, and the channel
     * sound plays from the moment the notification is posted, so leaving both on means two
     * overlapping alarms for as long as the hand-off takes. Once the full-screen intent is
     * available the activity is what the user ends up looking at, and the notification's
     * lifetime is the hand-off window, so the activity is the only sound worth keeping.
     *
     * <p>In the degraded mode there is no guarantee the activity ever starts - a background
     * activity launch is dropped on API 29+ - so the notification is the only thing that can
     * make noise, and taking the sound away would leave a silent alarm for a user who never
     * taps the shade entry.
     */
    static boolean shouldSoundWithNotification(int sdkInt, boolean canUseFullScreenIntent) {
        return !allowsFullScreenIntent(sdkInt, canUseFullScreenIntent);
    }

    /**
     * The notification ids an alarm hand-over has to withdraw.
     *
     * <p>{@link AlarmActivity} is {@code singleTask}, so a second alarm arriving while one is on
     * screen is delivered to {@code onNewIntent} on that same instance rather than to a new
     * one. A ringing notification is keyed by the id its alarm fired under, so the entry posted
     * for the alarm being replaced stops being reachable the moment the activity's current id is
     * reassigned. Cancelling only the arriving id therefore leaves the replaced alarm's entry in
     * the shade, and in sticky mode - the mode the full-screen-intent grant enables - that entry
     * is ongoing, with nothing left to take it down, because the activity meant to dismiss it is
     * that same instance now showing a different alarm.
     *
     * <p>Pure, so the rule is assertable on a desktop JVM; the activity cannot be instantiated
     * there. A same-id delivery collapses to one entry because {@code CLEAR_TOP} can redeliver
     * the same alarm into the existing instance, and a duplicate cancel is noise to every reader
     * of the call site.
     *
     * @return every id whose notification must be cancelled, replaced first
     */
    static int[] notificationIdsToWithdraw(int replacedAlarmId, int incomingAlarmId) {
        if (replacedAlarmId == incomingAlarmId) {
            return new int[]{incomingAlarmId};
        }
        return new int[]{replacedAlarmId, incomingAlarmId};
    }

    static void post(Context context, int alarmId, String title, String body) {
        if (context == null || !NativeAlarmPlugin.isValidAlarmId(alarmId)) {
            return;
        }
        Context applicationContext = context.getApplicationContext();
        if (applicationContext == null) {
            applicationContext = context;
        }

        String resolvedTitle = NativeAlarmPlugin.sanitizeText(
                title,
                NativeAlarmPlugin.FALLBACK_TITLE,
                NativeAlarmPlugin.MAX_TITLE_LENGTH
        );
        String resolvedBody = NativeAlarmPlugin.sanitizeText(
                body,
                NativeAlarmPlugin.FALLBACK_BODY,
                NativeAlarmPlugin.MAX_BODY_LENGTH
        );

        try {
            NotificationManager manager = (NotificationManager) applicationContext
                    .getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && manager.getNotificationChannel(CHANNEL_ID) == null) {
                // Only on first use. A channel is immutable once created, so this call cannot
                // change the sound or importance a returning user has already tuned, and
                // repeating it on every firing only spends a binder round trip.
                ensureChannel(manager);
            }

            PendingIntent contentIntent = createContentIntent(
                    applicationContext,
                    alarmId,
                    resolvedTitle,
                    resolvedBody
            );
            NotificationCompat.Builder builder = new NotificationCompat.Builder(
                    applicationContext,
                    CHANNEL_ID
            )
                    .setSmallIcon(R.drawable.ic_timer_icon)
                    .setContentTitle(resolvedTitle)
                    .setContentText(resolvedBody)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(resolvedBody))
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setAutoCancel(false)
                    .setContentIntent(contentIntent)
                    // AlarmActivity drives the vibrator and the MediaPlayer from the moment it
                    // takes the alarm over. Letting the channel buzz and ring as well would
                    // double the pulse for as long as the hand-off takes, which on the
                    // full-screen-intent path is the entire lifetime of the notification. An
                    // empty pattern is the documented per-notification way to say "no
                    // vibration" while the channel keeps its own setting.
                    .setVibrate(NO_VIBRATION);

            boolean canUseFullScreenIntent = Build.VERSION.SDK_INT >= FULL_SCREEN_INTENT_GATE
                    && manager.canUseFullScreenIntent();
            boolean fullScreenIntentAllowed = allowsFullScreenIntent(
                    Build.VERSION.SDK_INT,
                    canUseFullScreenIntent
            );
            if (fullScreenIntentAllowed) {
                // Only the content intent is ever attached: a full-screen intent must be an
                // activity, and reusing the same token also keeps the two in step when the
                // activity is relaunched by CLEAR_TOP.
                builder.setFullScreenIntent(contentIntent, true);
                // The activity is guaranteed to start over the lock screen here, so it owns the
                // sound; muting this notification removes the overlap. In the degraded branch
                // below the notification keeps the channel sound, because it may be the only
                // thing that makes any noise at all.
                builder.setSilent(true);
            }
            builder.setOngoing(
                    isStickyAlarmNotification(Build.VERSION.SDK_INT, canUseFullScreenIntent)
            );

            NotificationManagerCompat.from(applicationContext)
                    .notify(tagFor(alarmId), NOTIFICATION_ID, builder.build());
        } catch (Exception exception) {
            // NotificationManagerCompat swallows the SecurityException on API 33+ when
            // POST_NOTIFICATIONS is denied, so a missing runtime grant is a silent no-op
            // rather than a crash. Anything else is logged and dropped: the alarm has
            // already fired and the activity attempt has already been made.
            Log.e(LOG_TAG, "Alarm notification failed ("
                    + exception.getClass().getSimpleName() + ")");
        }
    }

    static void cancel(Context context, int alarmId) {
        if (context == null || !NativeAlarmPlugin.isValidAlarmId(alarmId)) {
            return;
        }
        try {
            NotificationManagerCompat.from(context).cancel(tagFor(alarmId), NOTIFICATION_ID);
            // Cancelling the notification does not retire the token that opened it. That token
            // is registered in the system server's pending-intent table under
            // (AlarmActivity, alarmId) and would otherwise survive until the process dies, so a
            // long-lived install accumulates one dead row per alarm id it ever rang for. The
            // next firing recreates it through FLAG_UPDATE_CURRENT, so retiring it here cannot
            // leave a later notification without a working tap target.
            cancelContentIntent(context, alarmId);
        } catch (Exception exception) {
            Log.w(LOG_TAG, "Alarm notification cleanup failed ("
                    + exception.getClass().getSimpleName() + ")");
        }
    }

    private static void ensureChannel(NotificationManager manager) {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Study Alarms",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Alarms scheduled in the Daily Study Tracker");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(true);
        channel.setVibrationPattern(NativeAlarmPlugin.alarmVibrationPattern());
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) {
            sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        }
        if (sound != null) {
            channel.setSound(
                    sound,
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
            );
        }
        manager.createNotificationChannel(channel);
    }

    private static PendingIntent createContentIntent(
            Context context,
            int alarmId,
            String title,
            String body
    ) {
        Intent intent = contentIntentTarget(context);
        intent.putExtra(EXTRA_ID, alarmId);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_BODY, body);
        return PendingIntent.getActivity(
                context,
                alarmId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | NativeAlarmPlugin.immutablePendingIntentFlag()
        );
    }

    /**
     * The token the content and full-screen intents share, without any extras. PendingIntent
     * identity covers the component, action, data, categories and type but not the extras, so
     * this is exactly what {@code getActivity} with {@code FLAG_NO_CREATE} has to be handed to
     * find the token {@link #createContentIntent} registered.
     */
    private static Intent contentIntentTarget(Context context) {
        Intent intent = new Intent(context, AlarmActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return intent;
    }

    private static void cancelContentIntent(Context context, int alarmId) {
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                alarmId,
                contentIntentTarget(context),
                PendingIntent.FLAG_NO_CREATE
                        | NativeAlarmPlugin.immutablePendingIntentFlag()
        );
        if (pendingIntent != null) {
            pendingIntent.cancel();
        }
    }
}
