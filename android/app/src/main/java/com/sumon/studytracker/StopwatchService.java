package com.sumon.studytracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;

public class StopwatchService extends Service {
    
    public static final String CHANNEL_ID = "stopwatch_channel";
    public static final String ACTION_START = "com.sumon.studytracker.STOPWATCH_START";
    public static final String ACTION_PAUSE = "com.sumon.studytracker.STOPWATCH_PAUSE";
    public static final String ACTION_STOP = "com.sumon.studytracker.STOPWATCH_STOP";
    public static final String EXTRA_BASE_TIME = "base_time";
    
    private static final int NOTIFICATION_ID = 1001;
    
    private Handler handler;
    private Runnable updateRunnable;
    private long baseTime = 0;
    private boolean isRunning = false;
    private int currentAppWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    
    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        handler = new Handler(Looper.getMainLooper());
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        
        // Update widget ID if provided
        int widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
            currentAppWidgetId = widgetId;
        }
        
        String action = intent.getAction();
        
        if (ACTION_START.equals(action)) {
            baseTime = intent.getLongExtra(EXTRA_BASE_TIME, SystemClock.elapsedRealtime());
            isRunning = true;
            // Show "Running" notification immediately
            startForeground(NOTIFICATION_ID, buildNotification(SystemClock.elapsedRealtime() - baseTime, true));
            startUpdating();
            
        } else if (ACTION_PAUSE.equals(action)) {
            // Keep service alive but stop updating time
            isRunning = false;
            stopUpdating();
            // Show "Paused" notification
            long elapsed = SystemClock.elapsedRealtime() - baseTime;
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, buildNotification(elapsed, false));
            }
            
        } else if (ACTION_STOP.equals(action)) {
            // Stop everything
            isRunning = false;
            stopUpdating();
            stopForeground(true);
            stopSelf();
        }
        
        return START_NOT_STICKY;
    }
    
    private void startUpdating() {
        stopUpdating(); // Ensure no duplicates
        updateRunnable = new Runnable() {
            @Override
            public void run() {
                if (isRunning) {
                    long elapsed = SystemClock.elapsedRealtime() - baseTime;
                    updateNotification(elapsed);
                    handler.postDelayed(this, 1000);
                }
            }
        };
        handler.post(updateRunnable);
    }
    
    private void stopUpdating() {
        if (updateRunnable != null) {
            handler.removeCallbacks(updateRunnable);
        }
    }
    
    private void updateNotification(long elapsedMillis) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification(elapsedMillis, true));
        }
    }
    
    private Notification buildNotification(long elapsedMillis, boolean isRunning) {
        // Format elapsed time
        long seconds = (elapsedMillis / 1000) % 60;
        long minutes = (elapsedMillis / (1000 * 60)) % 60;
        long hours = elapsedMillis / (1000 * 60 * 60);
        String timeStr = String.format("%02d:%02d:%02d", hours, minutes, seconds);
        
        // Intent to open app
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent openPendingIntent = PendingIntent.getActivity(this, 0, openIntent, 
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        
        // Determine Action: Pause or Resume
        // Send intent to StudyWidgetProvider to handle logic (syncs widget & prefs)
        Intent actionIntent = new Intent(this, StudyWidgetProvider.class);
        actionIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, currentAppWidgetId);
        
        String actionTitle;
        int actionIcon;
        
        if (isRunning) {
            // If running -> Show Pause button -> triggers ACTION_TIMER_PAUSE in Provider
            actionIntent.setAction("com.sumon.studytracker.ACTION_TIMER_PAUSE");
            actionTitle = "Pause";
            actionIcon = android.R.drawable.ic_media_pause;
        } else {
            // If paused -> Show Resume button -> triggers ACTION_TIMER_START in Provider
            actionIntent.setAction("com.sumon.studytracker.ACTION_TIMER_START");
            actionTitle = "Resume";
            actionIcon = android.R.drawable.ic_media_play;
        }
        
        PendingIntent actionPendingIntent = PendingIntent.getBroadcast(this, 1, actionIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        
        // Stop Action
        // Send intent to StudyWidgetProvider -> triggers ACTION_TIMER_RESET
        Intent stopIntent = new Intent(this, StudyWidgetProvider.class);
        stopIntent.setAction("com.sumon.studytracker.ACTION_TIMER_RESET");
        stopIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, currentAppWidgetId);
        
        PendingIntent stopPendingIntent = PendingIntent.getBroadcast(this, 2, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("📖 Study Timer")
            .setContentText((isRunning ? "⏱ " : "⏸ ") + timeStr)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setOngoing(true) // Persistent
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openPendingIntent)
            .addAction(actionIcon, actionTitle, actionPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPendingIntent);
            
        return builder.build();
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Study Timer",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows active study timer");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
    
    @Override
    public void onDestroy() {
        stopUpdating();
        super.onDestroy();
    }
}
