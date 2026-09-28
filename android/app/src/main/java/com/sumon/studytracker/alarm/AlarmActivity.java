package com.sumon.studytracker.alarm;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
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

import androidx.core.graphics.Insets;
import androidx.core.view.OnApplyWindowInsetsListener;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.sumon.studytracker.R;

import java.io.IOException;
import java.lang.ref.WeakReference;

public class AlarmActivity extends Activity {

    private static final String TAG = "AlarmActivity";

    private static final String EXTRA_ID = AlarmNotifications.EXTRA_ID;
    private static final String EXTRA_TITLE = AlarmNotifications.EXTRA_TITLE;
    private static final String EXTRA_BODY = AlarmNotifications.EXTRA_BODY;

    /**
     * Written on the main thread by the lifecycle callbacks and read from the Capacitor plugin
     * thread and the boot reconciler through {@link #stopAlarm(int)}, so both the reference and
     * the id it guards have to be published safely across that handover.
     */
    private static volatile WeakReference<AlarmActivity> activeActivity =
            new WeakReference<>(null);

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private volatile int currentAlarmId = -1;
    private boolean alarmFinished;

    static void stopAlarm(int id) {
        AlarmActivity activity = activeActivity.get();
        if (activity == null || (id != -1 && activity.currentAlarmId != id)) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (activeActivity.get() == activity) {
                    activity.finishAlarm();
                }
            }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) {
                keyguardManager.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_alarm);
        applySystemBarInsets();
        Intent intent = getIntent();
        currentAlarmId = readAlarmId(intent);
        if (!NativeAlarmPlugin.isValidAlarmId(currentAlarmId)) {
            // Only AlarmReceiver starts this activity and it validates the id, so an invalid
            // one means a malformed or foreign intent. Nothing to ring for.
            finish();
            return;
        }
        String title = resolvedTitle(intent);
        String body = resolvedBody(intent);

        TextView titleView = findViewById(R.id.alarm_title);
        TextView bodyView = findViewById(R.id.alarm_body);
        Button stopButton = findViewById(R.id.btn_stop_alarm);
        if (titleView != null) {
            titleView.setText(title);
        }
        if (bodyView != null) {
            bodyView.setText(body);
        }
        if (stopButton != null) {
            stopButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    finishAlarm();
                }
            });
        }

        // This activity owns the sound from here on, so the ringing notification that was
        // posted as the background-start fallback is withdrawn before MediaPlayer starts.
        AlarmNotifications.cancel(this, currentAlarmId);
        activeActivity = new WeakReference<>(this);
        startAlarmAudioAndVibration();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        int nextAlarmId = readAlarmId(intent);
        if (!NativeAlarmPlugin.isValidAlarmId(nextAlarmId)) {
            return;
        }
        // Captured before it is overwritten: once currentAlarmId names the arriving alarm, the id
        // the previous one was posted under is gone from the instance.
        int replacedAlarmId = currentAlarmId;
        currentAlarmId = nextAlarmId;
        // A second alarm reusing this singleTask instance arrives while finishAlarm() may
        // already have run, and the guard would otherwise discard the new alarm silently.
        alarmFinished = false;
        TextView titleView = findViewById(R.id.alarm_title);
        TextView bodyView = findViewById(R.id.alarm_body);
        if (titleView != null) {
            titleView.setText(resolvedTitle(intent));
        }
        if (bodyView != null) {
            bodyView.setText(resolvedBody(intent));
        }
        // Both the replaced alarm's entry and the arriving one's are withdrawn: the activity
        // owns the sound from here, so neither notification is wanted any more.
        for (int idToWithdraw : AlarmNotifications.notificationIdsToWithdraw(
                replacedAlarmId,
                currentAlarmId
        )) {
            AlarmNotifications.cancel(this, idToWithdraw);
        }
        releaseAlarmMedia();
        startAlarmAudioAndVibration();
    }

    /**
     * The alarm id, read through the same gate the store uses. {@code getIntExtra} throws a
     * {@link ClassCastException} when the extra is not an {@code Integer}, and an activity
     * launched from a system-sent token must never crash on the shape of its own extras.
     */
    private static int readAlarmId(Intent intent) {
        if (intent == null || intent.getExtras() == null) {
            return -1;
        }
        Integer id = NativeAlarmPlugin.exactId(intent.getExtras().get(EXTRA_ID));
        return id == null ? -1 : id;
    }

    private static String textExtra(Intent intent, String key) {
        if (intent == null || intent.getExtras() == null) {
            return null;
        }
        Object value = intent.getExtras().get(key);
        return value instanceof String ? (String) value : null;
    }

    /**
     * The alarm's title as it should be shown here.
     *
     * <p>Sanitised rather than passed through, and resolved against the shared fallback rather
     * than the layout's preview text, so the screen, the ringing notification and the
     * design-time preview cannot say three different things. An extra of the wrong type falls
     * back too: {@code textExtra} returns null for it and the fallback takes over, exactly as it
     * does for a missing one.
     */
    private static String resolvedTitle(Intent intent) {
        return NativeAlarmPlugin.sanitizeText(
                textExtra(intent, EXTRA_TITLE),
                NativeAlarmPlugin.FALLBACK_TITLE,
                NativeAlarmPlugin.MAX_TITLE_LENGTH
        );
    }

    private static String resolvedBody(Intent intent) {
        return NativeAlarmPlugin.sanitizeText(
                textExtra(intent, EXTRA_BODY),
                NativeAlarmPlugin.FALLBACK_BODY,
                NativeAlarmPlugin.MAX_BODY_LENGTH
        );
    }

    /**
     * Keeps the alarm content clear of the system bars.
     *
     * <p>This app targets API 36, and from API 35 the platform enforces edge-to-edge for such
     * apps: the window is laid out behind the status and navigation bars and the framework no
     * longer insets the content view for us. The alarm layout is a plain padded {@code
     * LinearLayout}, so without this the top of the icon is drawn under the status bar and the
     * stop button can sit under the navigation bar. Up to API 34 the decor already fits the
     * system windows, the insets reported here are zero, and this is a no-op.
     */
    private void applySystemBarInsets() {
        final View content = findViewById(android.R.id.content);
        if (content == null) {
            return;
        }
        ViewCompat.setOnApplyWindowInsetsListener(content,
                new OnApplyWindowInsetsListener() {
                    @Override
                    public WindowInsetsCompat onApplyWindowInsets(
                            View view,
                            WindowInsetsCompat windowInsets
                    ) {
                        Insets bars = windowInsets.getInsets(
                                WindowInsetsCompat.Type.systemBars()
                                        | WindowInsetsCompat.Type.displayCutout()
                        );
                        view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                        return windowInsets;
                    }
                });
        ViewCompat.requestApplyInsets(content);
    }

    private void startAlarmAudioAndVibration() {
        AssetFileDescriptor descriptor = null;
        try {
            descriptor = getResources().openRawResourceFd(R.raw.alarm_loop);
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build()
            );
            mediaPlayer.setDataSource(
                    descriptor.getFileDescriptor(),
                    descriptor.getStartOffset(),
                    descriptor.getLength()
            );
            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.setVolume(1.0f, 1.0f);
            mediaPlayer.start();
            startVibration();
        } catch (IOException | RuntimeException exception) {
            Log.e(TAG, "Alarm audio failed (" + exception.getClass().getSimpleName() + ")");
            releaseAlarmMedia();
        } finally {
            if (descriptor != null) {
                try {
                    descriptor.close();
                } catch (IOException exception) {
                    Log.w(TAG, "Alarm audio descriptor close failed");
                }
            }
        }
    }

    private void startVibration() {
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) {
            vibrator = null;
            return;
        }
        // The shared pattern, not a literal repeated here: this is the one place a native alarm
        // actually vibrates, and the notification channel is created from the same constant so
        // the two cannot drift into a doubled buzz.
        long[] pattern = NativeAlarmPlugin.alarmVibrationPattern();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
            vibrator.vibrate(pattern, 0);
        }
    }

    private void finishAlarm() {
        if (alarmFinished) {
            return;
        }
        alarmFinished = true;
        releaseAlarmMedia();
        AlarmNotifications.cancel(this, currentAlarmId);
        finish();
    }

    private void releaseAlarmMedia() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
            } catch (IllegalStateException exception) {
                Log.w(TAG, "Alarm media state was invalid");
            }
            mediaPlayer.release();
            mediaPlayer = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (activeActivity.get() == this) {
            activeActivity = new WeakReference<>(null);
        }
        // onBackPressed() below keeps the legacy callback alive, but any teardown that skips it
        // (a task eviction, a "don't keep activities" developer option) still has to silence the
        // ring, so the teardown path releases the media unconditionally.
        releaseAlarmMedia();
        if (isFinishing()) {
            AlarmNotifications.cancel(this, currentAlarmId);
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // The ringing alarm must not be dismissible with back, only with the stop button. The
        // manifest sets android:enableOnBackInvokedCallback="false" on this activity, which is
        // what keeps the platform dispatching back gestures to this callback; onDestroy() is the
        // backstop for the teardowns that never reach it.
    }
}
