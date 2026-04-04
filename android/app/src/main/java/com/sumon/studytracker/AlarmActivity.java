package com.sumon.studytracker;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import java.io.IOException;

public class AlarmActivity extends Activity {
    private static final String TAG = "AlarmActivity";
    public static final String ACTION_STOP_ALARM = "com.sumon.studytracker.STOP_ALARM";

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private int currentAlarmId = -1;

    // Receiver to allow the JavaScript plugin to stop the alarm remotely if needed
    private final BroadcastReceiver stopReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int id = intent.getIntExtra("id", -1);
            if (id == currentAlarmId || id == -1) {
                Log.d(TAG, "Received broadcast to stop alarm ID: " + currentAlarmId);
                finishAlarm();
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // --- 1. Wake Up the Screen & Bypass Lock Screen ---
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) {
                keyguardManager.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        // Keep screen on while ringing
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // --- 2. Build Basic Native UI ---
        // For absolute maximum reliability and lack of dependencies, we build a simple
        // UI in code.
        setContentView(com.sumon.studytracker.R.layout.activity_alarm); // We will create this layout

        Intent intent = getIntent();
        currentAlarmId = intent.getIntExtra("id", -1);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");

        TextView titleView = findViewById(com.sumon.studytracker.R.id.alarm_title);
        TextView bodyView = findViewById(com.sumon.studytracker.R.id.alarm_body);
        Button stopButton = findViewById(com.sumon.studytracker.R.id.btn_stop_alarm);

        if (titleView != null && title != null)
            titleView.setText(title);
        if (bodyView != null && body != null)
            bodyView.setText(body);

        stopButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finishAlarm();
            }
        });

        // Register the broadcast receiver to listen for programmatic stops
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stopReceiver, new IntentFilter(ACTION_STOP_ALARM), Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(stopReceiver, new IntentFilter(ACTION_STOP_ALARM));
        }

        // --- 3. Start Audio & Vibration ---
        startAlarmAudioAndVibration();
    }

    private void startAlarmAudioAndVibration() {
        try {
            // 1. Play Audio using MediaPlayer through the ALARM stream
            mediaPlayer = new MediaPlayer();

            // Set audio attributes to route through the alarm channel at high priority
            AudioAttributes.Builder attrsBuilder = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC);

            mediaPlayer.setAudioAttributes(attrsBuilder.build());

            // We use the same alarm_loop.mp3 from the web assets (copied to res/raw or
            // accessed via assets)
            // Note: We need to ensure alarm_loop.mp3 is accessible to native code.
            // Using a simple fallback or raw resource is safest.
            android.content.res.AssetFileDescriptor afd = getAssets().openFd("public/alarm_loop.mp3");
            mediaPlayer.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();

            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.setVolume(1.0f, 1.0f); // Max volume relative to system alarm volume
            mediaPlayer.start();

            // 2. Start Vibration
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = { 0, 500, 500 }; // Wait 0, Vibrate 500ms, Sleep 500ms...
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); // 0 means repeat indefinitely
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }

        } catch (IOException e) {
            Log.e(TAG, "Failed to start alarm audio", e);
        }
    }

    private void finishAlarm() {
        Log.d(TAG, "Finishing alarm...");
        if (mediaPlayer != null) {
            if (mediaPlayer.isPlaying()) {
                mediaPlayer.stop();
            }
            mediaPlayer.release();
            mediaPlayer = null;
        }

        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }

        finish(); // Close this activity, returning to whatever was below it (or sleep)
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try {
            unregisterReceiver(stopReceiver);
        } catch (IllegalArgumentException e) {
            // Ignore if not registered
        }
        finishAlarm(); // Ensure everything stops if the OS destroys the activity
    }

    @Override
    public void onBackPressed() {
        // Prevent back button from dismissing the alarm accidentally.
        // They must click the STOP button.
    }
}
