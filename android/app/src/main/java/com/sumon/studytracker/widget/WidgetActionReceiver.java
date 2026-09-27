package com.sumon.studytracker.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;

import com.sumon.studytracker.R;
import com.sumon.studytracker.service.StopwatchService;

public final class WidgetActionReceiver extends BroadcastReceiver {

    public static final String ACTION_TIMER_START =
            "com.sumon.studytracker.ACTION_TIMER_START";
    public static final String ACTION_TIMER_PAUSE =
            "com.sumon.studytracker.ACTION_TIMER_PAUSE";
    public static final String ACTION_TIMER_RESET =
            "com.sumon.studytracker.ACTION_TIMER_RESET";
    public static final String ACTION_THEME_TOGGLE =
            "com.sumon.studytracker.ACTION_THEME_TOGGLE";

    private static final String TAG = "WidgetActionReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        String action = intent.getAction();
        if (!ACTION_TIMER_START.equals(action)
                && !ACTION_TIMER_PAUSE.equals(action)
                && !ACTION_TIMER_RESET.equals(action)
                && !ACTION_THEME_TOGGLE.equals(action)) {
            return;
        }

        int appWidgetId = intent.getIntExtra(
                AppWidgetManager.EXTRA_APPWIDGET_ID,
                AppWidgetManager.INVALID_APPWIDGET_ID
        );

        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        if (appWidgetManager == null) {
            return;
        }
        // One binder round trip: the id list both validates this button's widget and lets the
        // repaint below skip its own membership test.
        int[] knownWidgetIds = StudyWidgetProvider.getWidgetIds(context, appWidgetManager);
        if (!StudyWidgetProvider.isKnownWidgetId(knownWidgetIds, appWidgetId)) {
            return;
        }

        Intent serviceIntent = new Intent(context, StopwatchService.class);
        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);

        try {
            SharedPreferences preferences = context.getSharedPreferences(
                    WidgetDataStore.PREFS_NAME,
                    Context.MODE_PRIVATE
            );
            SharedPreferences.Editor editor = preferences.edit();
            long nowElapsed = SystemClock.elapsedRealtime();
            WidgetTimerState state;

            if (ACTION_TIMER_START.equals(action)) {
                // Already running: the stored base is the truth, so re-deriving it from
                // pauseTime (which is 0 while running) would silently restart the timer at 0.
                state = WidgetTimerState.started(
                        preferences.getLong(StudyWidgetProvider.PREF_BASE + appWidgetId, 0L),
                        preferences.getLong(
                                StudyWidgetProvider.PREF_PAUSE_TIME + appWidgetId,
                                0L
                        ),
                        preferences.getBoolean(
                                StudyWidgetProvider.PREF_RUNNING + appWidgetId,
                                false
                        ),
                        nowElapsed
                );
                serviceIntent.setAction(StopwatchService.ACTION_START);
                serviceIntent.putExtra(StopwatchService.EXTRA_BASE_TIME, state.base());
            } else if (ACTION_TIMER_PAUSE.equals(action)) {
                // Pausing an already-stopped timer has no elapsed window to freeze: base stays at
                // whatever reset wrote, so now - base would grow with wall-clock time alone.
                state = WidgetTimerState.paused(
                        preferences.getLong(
                                StudyWidgetProvider.PREF_BASE + appWidgetId,
                                nowElapsed
                        ),
                        preferences.getLong(
                                StudyWidgetProvider.PREF_PAUSE_TIME + appWidgetId,
                                0L
                        ),
                        preferences.getBoolean(
                                StudyWidgetProvider.PREF_RUNNING + appWidgetId,
                                false
                        ),
                        nowElapsed
                );
                serviceIntent.setAction(StopwatchService.ACTION_PAUSE);
                serviceIntent.putExtra(StopwatchService.EXTRA_BASE_TIME, state.base());
            } else if (ACTION_TIMER_RESET.equals(action)) {
                state = WidgetTimerState.reset(nowElapsed);
                serviceIntent.setAction(StopwatchService.ACTION_STOP);
            } else {
                int newTheme = WidgetTheme.toggle(
                        preferences.getInt(StudyWidgetProvider.PREF_THEME + appWidgetId, WidgetTheme.DARK)
                );
                editor.putInt(StudyWidgetProvider.PREF_THEME + appWidgetId, newTheme);
                // Also the default for a widget that has never been toggled.
                editor.putInt(WidgetDataStore.PREF_THEME, newTheme);
                if (!editor.commit()) {
                    throw new IllegalStateException("Unable to persist widget action");
                }
                StudyWidgetProvider.updateAppWidget(context, appWidgetManager, appWidgetId, knownWidgetIds);
                // Repaint after the chrome so the row factory reads the committed theme.
                appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_list);
                return;
            }

            editor.putLong(StudyWidgetProvider.PREF_BASE + appWidgetId, state.base());
            editor.putLong(StudyWidgetProvider.PREF_PAUSE_TIME + appWidgetId, state.pauseTime());
            editor.putBoolean(StudyWidgetProvider.PREF_RUNNING + appWidgetId, state.running());
            // Persist before touching the service: a refused start must not roll the widget back.
            if (!editor.commit()) {
                throw new IllegalStateException("Unable to persist widget action");
            }
        } catch (Exception exception) {
            Log.e(TAG, "Widget action failed (" + exception.getClass().getSimpleName() + ")");
            return;
        }

        StudyWidgetProvider.updateAppWidget(context, appWidgetManager, appWidgetId, knownWidgetIds);
        startStopwatchService(context, serviceIntent);
    }

    /**
     * Builds the Intent behind a widget timer/theme button.
     *
     * <p>Exposed because a {@link PendingIntent} is identified by its request code <em>and</em> the
     * Intent's action/data/component, so {@link StudyWidgetProvider} and the stopwatch notification
     * have to build this identically. If they did not, the widget button and the notification
     * button would be two independent PendingIntents that could drift apart, and
     * {@code FLAG_UPDATE_CURRENT} on one would silently rewrite the other's extras.
     *
     * <p>The per-action data URI is what keeps the four actions distinct even though
     * {@link #requestCodeFor(int, String)} already folds the action into the request code; it is
     * belt and braces, and it survives a request code collision.
     */
    public static Intent buildActionIntent(Context context, int appWidgetId, String action) {
        Intent intent = new Intent(context, WidgetActionReceiver.class);
        intent.setAction(action);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        intent.setData(Uri.parse(actionDataUri(appWidgetId, action)));
        return intent;
    }

    /**
     * The data half of the {@link PendingIntent} identity. Pure string building, so the uniqueness
     * that keeps two actions from sharing one PendingIntent can be unit tested.
     */
    static String actionDataUri(int appWidgetId, String action) {
        return "studywidget://action/" + appWidgetId + "/" + (action == null ? 0 : action.hashCode());
    }

    /** The immutable PendingIntent for a widget button, shared with the stopwatch notification. */
    public static PendingIntent getActionPendingIntent(
            Context context,
            int appWidgetId,
            String action
    ) {
        return PendingIntent.getBroadcast(
                context,
                requestCodeFor(appWidgetId, action),
                buildActionIntent(context, appWidgetId, action),
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );
    }

    private static int immutableFlag() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_IMMUTABLE;
        }
        return 0;
    }

    /**
     * Shared with {@link StopwatchService} so the notification buttons and the widget buttons
     * resolve to the same PendingIntent key for the same widget, instead of two copies that can
     * drift apart.
     */
    public static int requestCodeFor(int appWidgetId, String action) {
        return 31 * (appWidgetId ^ (appWidgetId >>> 16)) + (action == null ? 0 : action.hashCode());
    }

    private static void startStopwatchService(Context context, Intent serviceIntent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (Exception exception) {
            // The home screen timer is driven by Chronometer, so only the notification is lost.
            Log.w(
                    TAG,
                    "Stopwatch service not started ("
                            + exception.getClass().getSimpleName()
                            + ")"
            );
        }
    }
}
