package com.sumon.studytracker;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class StudyWidgetProvider extends AppWidgetProvider {

    private static final String ACTION_TIMER_START = "com.sumon.studytracker.ACTION_TIMER_START";
    private static final String ACTION_TIMER_PAUSE = "com.sumon.studytracker.ACTION_TIMER_PAUSE";
    private static final String ACTION_TIMER_RESET = "com.sumon.studytracker.ACTION_TIMER_RESET";
    private static final String ACTION_THEME_TOGGLE = "com.sumon.studytracker.ACTION_THEME_TOGGLE";

    private static final String PREFS_NAME = "WidgetPrefs";
    private static final String PREF_BASE = "timer_base_";
    private static final String PREF_RUNNING = "timer_running_";
    private static final String PREF_PAUSE_TIME = "timer_pause_time_";
    private static final String PREF_THEME = "widget_theme_";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);

        String action = intent.getAction();
        int appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);

        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();

        if (ACTION_TIMER_START.equals(action)) {
            long pauseTime = prefs.getLong(PREF_PAUSE_TIME + appWidgetId, 0);
            long base = SystemClock.elapsedRealtime() - pauseTime;
            editor.putLong(PREF_BASE + appWidgetId, base);
            editor.putBoolean(PREF_RUNNING + appWidgetId, true);
            editor.apply();
            updateAppWidget(context, AppWidgetManager.getInstance(context), appWidgetId);
            
            // Start foreground notification service
            Intent serviceIntent = new Intent(context, StopwatchService.class);
            serviceIntent.setAction(StopwatchService.ACTION_START);
            serviceIntent.putExtra(StopwatchService.EXTRA_BASE_TIME, base);
            serviceIntent.putExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            context.startForegroundService(serviceIntent);

        } else if (ACTION_TIMER_PAUSE.equals(action)) {
            long base = prefs.getLong(PREF_BASE + appWidgetId, SystemClock.elapsedRealtime());
            long pauseTime = SystemClock.elapsedRealtime() - base;
            editor.putLong(PREF_PAUSE_TIME + appWidgetId, pauseTime);
            editor.putBoolean(PREF_RUNNING + appWidgetId, false);
            editor.apply();
            updateAppWidget(context, AppWidgetManager.getInstance(context), appWidgetId);
            
            // Stop foreground notification service
            Intent serviceIntent = new Intent(context, StopwatchService.class);
            serviceIntent.setAction(StopwatchService.ACTION_PAUSE);
            serviceIntent.putExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            context.startService(serviceIntent);

        } else if (ACTION_TIMER_RESET.equals(action)) {
            editor.putLong(PREF_BASE + appWidgetId, SystemClock.elapsedRealtime());
            editor.putLong(PREF_PAUSE_TIME + appWidgetId, 0);
            editor.putBoolean(PREF_RUNNING + appWidgetId, false);
            editor.apply();
            updateAppWidget(context, AppWidgetManager.getInstance(context), appWidgetId);
            
            // Stop foreground notification service
            Intent serviceIntent = new Intent(context, StopwatchService.class);
            serviceIntent.setAction(StopwatchService.ACTION_STOP);
            serviceIntent.putExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            context.startService(serviceIntent);

        } else if (ACTION_THEME_TOGGLE.equals(action)) {
            int currentTheme = prefs.getInt(PREF_THEME + appWidgetId, 0);
            int newTheme = (currentTheme + 1) % 2; // Cycle 2 themes: Dark (0), Light (1)
            editor.putInt(PREF_THEME + appWidgetId, newTheme);
            editor.putInt("current_theme", newTheme); // Store for service to read
            editor.apply();
            AppWidgetManager awm = AppWidgetManager.getInstance(context);
            updateAppWidget(context, awm, appWidgetId);
            // Force list refresh to pick up new theme colors
            awm.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_list);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout);

        // --- 1. THEME LOGIC (2 themes: Dark & Light) ---
        int theme = prefs.getInt(PREF_THEME + appWidgetId, 0);
        boolean isLightTheme = (theme == 1);
        
        // Apply background and section colors
        if (isLightTheme) {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_light);
            views.setInt(R.id.widget_date_section, "setBackgroundResource", R.drawable.widget_section_light);
            views.setInt(R.id.widget_timer_section, "setBackgroundResource", R.drawable.widget_section_light);
        } else {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg);
            views.setInt(R.id.widget_date_section, "setBackgroundResource", R.drawable.widget_section_dark);
            views.setInt(R.id.widget_timer_section, "setBackgroundResource", R.drawable.widget_section_dark);
        }
        
        // Button colors
        int playBtnColor = 0xFF22C55E;  // Green-500
        int pauseBtnColor = 0xFFEAB308; // Yellow-500
        int resetBtnColor = 0xFFEF4444; // Red-500
        int themeBtnColor = isLightTheme ? 0xFF64748B : 0xFF475569;
        
        // Apply button backgrounds
        views.setInt(R.id.widget_btn_play, "setBackgroundColor", playBtnColor);
        views.setInt(R.id.widget_btn_pause, "setBackgroundColor", pauseBtnColor);
        views.setInt(R.id.widget_btn_reset, "setBackgroundColor", resetBtnColor);
        views.setInt(R.id.widget_theme_btn, "setBackgroundColor", themeBtnColor);
        
        // Apply button text colors (always white)
        views.setTextColor(R.id.widget_btn_play, 0xFFFFFFFF);
        views.setTextColor(R.id.widget_btn_pause, 0xFFFFFFFF);
        views.setTextColor(R.id.widget_btn_reset, 0xFFFFFFFF);
        views.setTextColor(R.id.widget_theme_btn, 0xFFFFFFFF);
        
        // Apply text colors based on theme
        if (isLightTheme) {
            int darkText = 0xFF0F172A;
            int mutedText = 0xFF475569;
            views.setTextColor(R.id.widget_date_day, darkText);
            views.setTextColor(R.id.widget_date_full, mutedText);
            views.setTextColor(R.id.widget_timer_chronometer, darkText);
            views.setTextColor(R.id.widget_clock, darkText);
        } else {
            int whiteText = 0xFFFFFFFF;
            int mutedWhite = 0xFF94A3B8;
            views.setTextColor(R.id.widget_date_day, whiteText);
            views.setTextColor(R.id.widget_date_full, mutedWhite);
            views.setTextColor(R.id.widget_timer_chronometer, whiteText);
            views.setTextColor(R.id.widget_clock, whiteText);
        }

        // --- 2. DATE LOGIC ---
        SimpleDateFormat dayFormat = new SimpleDateFormat("EEEE", Locale.getDefault());
        SimpleDateFormat dateFormat = new SimpleDateFormat("MMM d, yyyy", Locale.getDefault());
        Date now = new Date();
        views.setTextViewText(R.id.widget_date_day, dayFormat.format(now));
        views.setTextViewText(R.id.widget_date_full, dateFormat.format(now));

        // --- 3. TIMER LOGIC ---
        long base = prefs.getLong(PREF_BASE + appWidgetId, SystemClock.elapsedRealtime());
        long pauseTime = prefs.getLong(PREF_PAUSE_TIME + appWidgetId, 0);
        boolean isRunning = prefs.getBoolean(PREF_RUNNING + appWidgetId, false);

        if (isRunning) {
            views.setChronometer(R.id.widget_timer_chronometer, base, "%s", true);
        } else {
            views.setChronometer(R.id.widget_timer_chronometer, SystemClock.elapsedRealtime() - pauseTime, "%s", false);
        }

        // --- 4. LIST LOGIC ---
        Intent serviceIntent = new Intent(context, StudyWidgetService.class);
        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        serviceIntent.setData(Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, serviceIntent);
        views.setEmptyView(R.id.widget_list, R.id.empty_view);

        // --- 5. BINDING INTENTS ---
        // Click on empty space opens the app
        Intent openAppIntent = new Intent(context, MainActivity.class);
        PendingIntent openAppPendingIntent = PendingIntent.getActivity(context, 0, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, openAppPendingIntent);
        
        // Timer buttons
        views.setOnClickPendingIntent(R.id.widget_btn_play, getSelfPendingIntent(context, appWidgetId, ACTION_TIMER_START));
        views.setOnClickPendingIntent(R.id.widget_btn_pause, getSelfPendingIntent(context, appWidgetId, ACTION_TIMER_PAUSE));
        views.setOnClickPendingIntent(R.id.widget_btn_reset, getSelfPendingIntent(context, appWidgetId, ACTION_TIMER_RESET));
        views.setOnClickPendingIntent(R.id.widget_theme_btn, getSelfPendingIntent(context, appWidgetId, ACTION_THEME_TOGGLE));

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static PendingIntent getSelfPendingIntent(Context context, int appWidgetId, String action) {
        Intent intent = new Intent(context, StudyWidgetProvider.class);
        intent.setAction(action);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        // Use unique request code per action to avoid PendingIntent collisions
        int uniqueCode = appWidgetId * 10 + action.hashCode();
        return PendingIntent.getBroadcast(context, uniqueCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
