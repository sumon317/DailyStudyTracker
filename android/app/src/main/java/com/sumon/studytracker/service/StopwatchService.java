package com.sumon.studytracker.service;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.sumon.studytracker.MainActivity;
import com.sumon.studytracker.R;
import com.sumon.studytracker.widget.StudyWidgetProvider;
import com.sumon.studytracker.widget.WidgetActionReceiver;
import com.sumon.studytracker.widget.WidgetDataStore;
import com.sumon.studytracker.widget.WidgetTimeUtils;

import java.util.HashMap;
import java.util.Map;

public class StopwatchService extends Service {

    public static final String CHANNEL_ID = "stopwatch_channel";
    public static final String ACTION_START = "com.sumon.studytracker.STOPWATCH_START";
    public static final String ACTION_PAUSE = "com.sumon.studytracker.STOPWATCH_PAUSE";
    public static final String ACTION_STOP = "com.sumon.studytracker.STOPWATCH_STOP";
    public static final String EXTRA_BASE_TIME = "base_time";

    /**
     * Distinct from the alarm package's notification id (1) and its "native_alarm" channel, so the
     * two features can never overwrite or cancel each other's notification.
     */
    private static final int NOTIFICATION_ID = 1001;
    private static final String TAG = "StopwatchService";

    private Handler handler;
    private Runnable updateRunnable;
    private long baseTime;
    private boolean running;
    private boolean foreground;
    private int currentAppWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    /**
     * The notification is rebuilt every second, so the action PendingIntents are cached and only
     * recreated when the owning widget changes. The cache is keyed by action: the shade shows a
     * different action for the first button while running (Pause) and while paused (Resume), so a
     * cache that only remembered "pause vs everything else" would hand the Resume button the
     * already-cached Stop PendingIntent and silently turn Resume into a reset.
     */
    private int actionPendingIntentWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private final Map<String, PendingIntent> actionPendingIntents = new HashMap<>();
    private PendingIntent openAppPendingIntent;

    private static final long WIDGET_VALIDITY_TTL_MILLIS = 30_000L;

    private boolean widgetValidityKnown;
    private boolean widgetValid;
    private long widgetValidityCheckedAt;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        handler = new Handler(Looper.getMainLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // A null intent can only reach a service started with startForegroundService, so the
            // promotion contract still applies before the teardown.
            if (!foreground && !promoteToForeground(0L)) {
                return START_NOT_STICKY;
            }
            running = false;
            stopUpdating();
            stopForeground(STOP_FOREGROUND_REMOVE);
            foreground = false;
            clearActionPendingIntents();
            stopSelf();
            return START_NOT_STICKY;
        }

        int widgetId = intent.getIntExtra(
                AppWidgetManager.EXTRA_APPWIDGET_ID,
                AppWidgetManager.INVALID_APPWIDGET_ID
        );
        // Assigned unconditionally, including for an id that is no longer placed: keeping the
        // previous widget alive here would resolve the base from another widget's preferences and
        // leave its id behind in the notification buttons.
        currentAppWidgetId = widgetId;
        invalidateWidgetValidity();

        String action = intent.getAction();
        if (ACTION_START.equals(action)) {
            baseTime = resolveBaseTime(intent.getLongExtra(EXTRA_BASE_TIME, 0L));
            running = true;
            if (!promoteToForeground(elapsedMillis())) {
                return START_NOT_STICKY;
            }
            startUpdating();
        } else if (ACTION_PAUSE.equals(action)) {
            running = false;
            stopUpdating();
            baseTime = resolveBaseTime(intent.getLongExtra(EXTRA_BASE_TIME, 0L));
            if (!promoteToForeground(elapsedMillis())) {
                return START_NOT_STICKY;
            }
        } else if (ACTION_STOP.equals(action)) {
            // A stop can be the first command after startForegroundService (the service was
            // killed, the device rebooted, or nothing was running yet). Returning without ever
            // calling startForeground trips ForegroundServiceDidNotStartInTimeException and
            // takes the process down, so promotion happens before the teardown.
            if (!foreground && !promoteToForeground(0L)) {
                return START_NOT_STICKY;
            }
            running = false;
            stopUpdating();
            stopForeground(STOP_FOREGROUND_REMOVE);
            foreground = false;
            clearActionPendingIntents();
            stopSelf();
        } else if (!foreground) {
            // Unrecognised command on a service that was never promoted: same contract, so
            // promote first and let the promotion failure stop the service cleanly. Tearing down
            // afterwards matters as much as promoting: the service would otherwise sit in the
            // foreground forever showing "Paused 00:00:00" for a command nobody understands.
            if (!promoteToForeground(0L)) {
                return START_NOT_STICKY;
            }
            running = false;
            stopUpdating();
            stopForeground(STOP_FOREGROUND_REMOVE);
            foreground = false;
            clearActionPendingIntents();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    /**
     * Resolves the {@code elapsedRealtime} base for this run, rejecting a base that did not
     * survive a reboot. The service may be started without an extra, in which case the value
     * persisted by the widget is authoritative.
     */
    private long resolveBaseTime(long requestedBase) {
        long nowElapsed = SystemClock.elapsedRealtime();
        if (!WidgetTimeUtils.isStaleTimerBase(requestedBase, nowElapsed)
                && currentAppWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
            return requestedBase;
        }
        if (currentAppWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            return nowElapsed;
        }
        SharedPreferences preferences = getSharedPreferences(
                WidgetDataStore.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        long storedBase = preferences.getLong(
                StudyWidgetProvider.PREF_BASE + currentAppWidgetId,
                0L
        );
        if (WidgetTimeUtils.isStaleTimerBase(storedBase, nowElapsed)) {
            return nowElapsed;
        }
        return storedBase;
    }

    /**
     * Satisfies the platform contract that every {@code startForegroundService} start must reach
     * {@code startForeground}. Returns false when promotion was refused, in which case the service
     * stops instead of crashing the process. The home screen timer keeps working either way because
     * it is driven by {@code Chronometer} rather than by this service.
     */
    private boolean promoteToForeground(long elapsedMillis) {
        if (foreground) {
            // Already promoted by an earlier command; keep the same notification id alive.
            updateNotification(elapsedMillis);
            return true;
        }
        try {
            startForeground(NOTIFICATION_ID, buildNotification(elapsedMillis, running));
            foreground = true;
            return true;
        } catch (RuntimeException exception) {
            Log.w(
                    TAG,
                    "Foreground promotion refused ("
                            + exception.getClass().getSimpleName()
                            + ")"
            );
            running = false;
            stopSelf();
            return false;
        }
    }

    private void startUpdating() {
        stopUpdating();
        updateRunnable = new Runnable() {
            @Override
            public void run() {
                if (running) {
                    updateNotification(elapsedMillis());
                    handler.postDelayed(this, 1000);
                }
            }
        };
        handler.post(updateRunnable);
    }

    private long elapsedMillis() {
        return WidgetTimeUtils.elapsedSinceBase(SystemClock.elapsedRealtime(), baseTime);
    }

    private void stopUpdating() {
        if (updateRunnable != null) {
            handler.removeCallbacks(updateRunnable);
            updateRunnable = null;
        }
    }

    /**
     * The notification is rebuilt every second, and every membership check against
     * {@link AppWidgetManager} is a binder round trip, so the answer is cached for a short window.
     * A widget removed mid-session therefore drops its buttons from the shade within half a minute
     * instead of never.
     */
    private boolean hasLiveWidget() {
        if (currentAppWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            invalidateWidgetValidity();
            return false;
        }
        long now = SystemClock.elapsedRealtime();
        if (widgetValidityKnown && now - widgetValidityCheckedAt < WIDGET_VALIDITY_TTL_MILLIS) {
            return widgetValid;
        }
        widgetValid = StudyWidgetProvider.isValidWidgetId(this, currentAppWidgetId);
        widgetValidityKnown = true;
        widgetValidityCheckedAt = now;
        return widgetValid;
    }

    private void invalidateWidgetValidity() {
        widgetValidityKnown = false;
        widgetValid = false;
        widgetValidityCheckedAt = 0L;
    }

    private void updateNotification(long elapsedMillis) {
        // Never let a notification failure escape into onStartCommand or the 1 Hz runnable: a
        // throw there kills a started service, and a throw in the runnable kills it silently.
        try {
            NotificationManager manager = (NotificationManager) getSystemService(
                    Context.NOTIFICATION_SERVICE
            );
            if (manager == null) {
                Log.w(TAG, "Notification manager unavailable");
                return;
            }
            manager.notify(NOTIFICATION_ID, buildNotification(elapsedMillis, running));
        } catch (RuntimeException exception) {
            Log.w(TAG, "Notification update failed (" + exception.getClass().getSimpleName() + ")");
        }
    }

    private Notification buildNotification(long elapsedMillis, boolean isRunning) {
        String time = StopwatchFormat.elapsedText(elapsedMillis);

        PendingIntent openPendingIntent = getOpenAppPendingIntent();
        // The timer buttons drive a widget, so they are only useful while that widget is placed.
        // Rendering them with a stale id would leave dead controls in the notification shade.
        boolean hasWidget = hasLiveWidget();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Study Timer")
                .setContentText((isRunning ? "Running " : "Paused ") + time)
                .setSmallIcon(R.drawable.ic_timer_icon)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openPendingIntent);
        if (hasWidget) {
            builder.addAction(
                    isRunning ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                    isRunning ? "Pause" : "Resume",
                    getActionPendingIntent(
                            isRunning
                                    ? WidgetActionReceiver.ACTION_TIMER_PAUSE
                                    : WidgetActionReceiver.ACTION_TIMER_START
                    )
            );
            builder.addAction(
                    android.R.drawable.ic_menu_close_clear_cancel,
                    "Stop",
                    getActionPendingIntent(WidgetActionReceiver.ACTION_TIMER_RESET)
            );
        }
        return builder.build();
    }

    private PendingIntent getOpenAppPendingIntent() {
        if (openAppPendingIntent == null) {
            openAppPendingIntent = PendingIntent.getActivity(
                    this,
                    0,
                    new Intent(this, MainActivity.class),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }
        return openAppPendingIntent;
    }

    private PendingIntent getActionPendingIntent(String action) {
        if (actionPendingIntentWidgetId != currentAppWidgetId) {
            clearActionPendingIntents();
        }
        PendingIntent cached = actionPendingIntents.get(action);
        if (cached != null) {
            return cached;
        }

        // Built by the same helper the widget buttons use, so both surfaces resolve to one
        // PendingIntent per (widget, action) instead of two that can drift apart.
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                this,
                WidgetActionReceiver.requestCodeFor(currentAppWidgetId, action),
                WidgetActionReceiver.buildActionIntent(this, currentAppWidgetId, action),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        actionPendingIntents.put(action, pendingIntent);
        actionPendingIntentWidgetId = currentAppWidgetId;
        return pendingIntent;
    }

    private void clearActionPendingIntents() {
        actionPendingIntents.clear();
        actionPendingIntentWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Study Timer",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Shows active study timer");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopUpdating();
        running = false;
        foreground = false;
        clearActionPendingIntents();
        super.onDestroy();
    }
}
