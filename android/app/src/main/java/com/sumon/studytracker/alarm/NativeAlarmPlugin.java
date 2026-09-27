package com.sumon.studytracker.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.sumon.studytracker.MainActivity;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "NativeAlarm")
public class NativeAlarmPlugin extends Plugin {

    static final String PREFS_NAME = "NativeAlarmPrefs";
    static final String PREF_DEFINITIONS = "enabled_definitions";
    static final long MAX_ALARM_ID = 0x7fffffffL;
    /**
     * Serialises every read-modify-write of the alarm store. The plugin methods all run on the
     * single Capacitor plugin thread, but {@link #reconcilePersistedAlarms} is also driven by
     * {@link BootReceiver} from a background thread, and SharedPreferences gives no way to make
     * a load/arm/commit sequence atomic on its own.
     */
    private static final Object STORE_LOCK = new Object();
    /**
     * Upper bound on how far ahead a single alarm may be armed. Alarms are re-armed on every
     * boot, update and foreground pass, so a far-future timestamp is always a bug rather than
     * a long-lived schedule, and rejecting it keeps an out-of-range value from reaching
     * {@link AlarmManager.AlarmClockInfo}.
     */
    static final long MAX_ALARM_HORIZON_MILLIS = 400L * 24L * 60L * 60L * 1000L;
    /**
     * Bound on the persisted store so BOOT_COMPLETED and MY_PACKAGE_REPLACED re-arm a fixed
     * number of alarms instead of whatever a previous session happened to leave behind.
     */
    static final int MAX_DEFINITIONS = 64;
    static final int MAX_TITLE_LENGTH = 200;
    static final int MAX_BODY_LENGTH = 512;

    private static final String ACTION_ALARM = "com.sumon.studytracker.action.NATIVE_ALARM";
    private static final String ACTION_SHOW_ALARM = "com.sumon.studytracker.action.SHOW_ALARM";
    /**
     * What the web layer substitutes when it schedules an alarm without wording of its own.
     * These are the defaults for a <em>scheduled</em> alarm, so they are deliberately terse.
     */
    static final String DEFAULT_TITLE = "Alarm";
    static final String DEFAULT_BODY = "Time is up!";
    /**
     * What the delivery side substitutes when an alarm fires with no usable wording attached.
     *
     * <p>These are the user-facing strings: the ringing notification, the alarm activity and
     * {@code activity_alarm.xml}'s design-time preview all have to say the same thing, so the
     * value lives here rather than being repeated per consumer. They were previously spelled
     * independently in three places, and a divergence between the notification and the screen
     * it opens is exactly the kind of drift that survives a final pass.
     */
    static final String FALLBACK_TITLE = "Time's Up!";
    static final String FALLBACK_BODY = "Your scheduled time has finished.";
    /**
     * The one vibration pattern for a native alarm. {@link AlarmActivity} drives the
     * {@link android.os.Vibrator} with this and the notification channel is created with it, so
     * the two cannot drift into a doubled buzz.
     */
    private static final long[] ALARM_VIBRATION_PATTERN = {0L, 500L, 500L};
    private static final String TAG = "NativeAlarmPlugin";

    /**
     * A defensive copy of the alarm's vibration pattern. A {@code long[]} constant is mutable
     * shared state, and the pattern is handed to a notification channel and to the vibrator, so
     * every caller gets its own array.
     */
    static long[] alarmVibrationPattern() {
        return ALARM_VIBRATION_PATTERN.clone();
    }

    @PluginMethod
    public void scheduleAlarm(PluginCall call) {
        Integer id = readId(call);
        Long time = readTimestamp(call);
        if (id == null || time == null) {
            call.reject("Must provide a positive 31-bit id and a timestamp in milliseconds");
            return;
        }
        long now = System.currentTimeMillis();
        if (!isValidAlarmTime(now, time)) {
            call.reject("Alarm time must be in the future and within the supported horizon");
            return;
        }

        AlarmDefinition definition = new AlarmDefinition(
                id,
                time,
                sanitizeText(readString(call, "title", DEFAULT_TITLE), DEFAULT_TITLE, MAX_TITLE_LENGTH),
                sanitizeText(readString(call, "body", DEFAULT_BODY), DEFAULT_BODY, MAX_BODY_LENGTH)
        );

        try {
            Context context = getContext();
            synchronized (STORE_LOCK) {
                // Expired entries are dropped on the way in. They can never fire again, and
                // leaving them in the store would let a long-lived install fill the store up to
                // MAX_DEFINITIONS and refuse every future alarm with no way to recover.
                List<AlarmDefinition> definitions = retainArmable(
                        loadDefinitions(context).definitions,
                        now
                );
                if (!upsertDefinition(definitions, definition)) {
                    call.reject("At most " + MAX_DEFINITIONS + " alarms can be armed");
                    return;
                }
                // Arm before recording: the system must be able to fire the alarm even if the
                // store write fails, and a rolled-back arm keeps the store from ever claiming an
                // alarm the system will not deliver.
                cancelAlarmInternal(context, id);
                scheduleDefinition(context, definition);
                try {
                    persistDefinitions(context, definitions);
                } catch (Exception persistFailure) {
                    cancelAlarmInternal(context, id);
                    throw persistFailure;
                }
            }
            call.resolve();
        } catch (Exception exception) {
            logFailure("Scheduling alarm", exception);
            call.reject("Unable to schedule alarm");
        }
    }

    @PluginMethod
    public void cancelAlarm(PluginCall call) {
        Integer id = readId(call);
        if (id == null) {
            call.reject("Must provide a positive 31-bit id");
            return;
        }

        try {
            Context context = getContext();
            synchronized (STORE_LOCK) {
                // The same prune as scheduleAlarm: this write is the store's only chance to
                // shed entries that can no longer fire, and cancelAlarm is the path a caller
                // uses to retire exactly the alarms it no longer wants.
                List<AlarmDefinition> definitions = retainArmable(
                        loadDefinitions(context).definitions,
                        System.currentTimeMillis()
                );
                removeDefinition(definitions, id);
                persistDefinitions(context, definitions);
                disarmAlarm(context, id);
            }
            call.resolve();
        } catch (Exception exception) {
            logFailure("Cancelling alarm", exception);
            call.reject("Unable to cancel alarm");
        }
    }

    @PluginMethod
    public void syncAlarms(PluginCall call) {
        try {
            Object rawAlarms = call.getData() == null ? null : call.getData().opt("alarms");
            // Parsed before the store is touched so a malformed batch cannot leave the store
            // half-replaced: nothing is cancelled until the whole batch is known to be valid.
            List<AlarmDefinition> incoming = parseDefinitions(rawAlarms);
            Context context = getContext();
            synchronized (STORE_LOCK) {
                // Deliberately the unpruned load: idsToCancel is a difference against the
                // persisted set, and an expired entry that the incoming batch still mentions
                // must not be cancelled out from under a re-armed schedule. Expired entries
                // missing from the batch are cancelled here, which is what retires them.
                List<AlarmDefinition> existing = loadDefinitions(context).definitions;

                // Everything the incoming store no longer mentions is cancelled and, if it is
                // ringing right now, silenced. A bulk sync is a full replacement, so a definition
                // left out here must not keep playing.
                for (Integer id : idsToCancel(existing, incoming)) {
                    disarmAlarm(context, id);
                }

                List<Integer> failures = new ArrayList<>();
                for (AlarmDefinition definition : incoming) {
                    try {
                        scheduleDefinition(context, definition);
                    } catch (Exception exception) {
                        logFailure("Synchronising alarm", exception);
                        failures.add(definition.id);
                    }
                }

                // The incoming set is the desired state and is stored even when an individual
                // arm failed, so reconcileAlarms can retry it instead of losing the definition.
                persistDefinitions(context, incoming);

                if (!failures.isEmpty()) {
                    call.reject("Unable to schedule " + failures.size() + " of " + incoming.size()
                            + " alarms");
                    return;
                }
            }
            call.resolve();
        } catch (IllegalArgumentException exception) {
            call.reject(exception.getMessage());
        } catch (Exception exception) {
            logFailure("Synchronising alarms", exception);
            call.reject("Unable to synchronise alarms");
        }
    }

    @PluginMethod
    public void reconcileAlarms(PluginCall call) {
        try {
            reconcilePersistedAlarms(getContext());
            call.resolve();
        } catch (Exception exception) {
            logFailure("Reconciling alarms", exception);
            call.reject("Unable to reconcile alarms");
        }
    }

    static void reconcilePersistedAlarms(Context context) throws Exception {
        if (context == null) {
            return;
        }
        Context applicationContext = context.getApplicationContext();
        if (applicationContext == null) {
            applicationContext = context;
        }
        synchronized (STORE_LOCK) {
            long now = System.currentTimeMillis();
            StoredDefinitions stored = loadDefinitions(applicationContext);
            // Reconcile is the pass that runs on boot, on update and on every resume, so it is
            // where expired definitions are garbage collected. Nothing else prunes on its own:
            // an alarm whose time has passed is still worth keeping until a pass is certain no
            // other writer is mid-flight, and by then it can never be armed again anyway.
            List<AlarmDefinition> armable = retainArmable(stored.definitions(), now);
            if (shouldRewriteStore(
                    stored.persistedCount(),
                    stored.definitions().size(),
                    armable.size()
            )) {
                try {
                    persistDefinitions(applicationContext, armable);
                } catch (Exception pruneFailure) {
                    // A failed prune must not stop the alarms that are still valid from being
                    // re-armed, so it is logged and the pass continues.
                    logFailure("Pruning expired alarms", pruneFailure);
                }
            }
            Exception firstFailure = null;
            for (AlarmDefinition definition : armable) {
                try {
                    scheduleDefinition(applicationContext, definition);
                } catch (Exception exception) {
                    logFailure("Reconciling alarm", exception);
                    if (firstFailure == null) {
                        firstFailure = exception;
                    }
                }
            }
            if (firstFailure != null) {
                throw firstFailure;
            }
        }
    }

    static boolean isValidAlarmId(long id) {
        return id > 0 && id <= MAX_ALARM_ID;
    }

    /**
     * An alarm has to be in the future, and no further out than the re-arm horizon. Both
     * operands are positive so the subtraction cannot overflow.
     */
    static boolean isValidAlarmTime(long now, long time) {
        return time > now && isWithinHorizon(now, time);
    }

    /**
     * The upper half of {@link #isValidAlarmTime}, split out because a timestamp that is already
     * in the past is a normal occurrence (an alarm that just fired) while a timestamp beyond the
     * horizon is always a bug. A bulk sync therefore accepts a stale entry but refuses one that
     * could never be a real schedule, matching what {@code scheduleAlarm} enforces one by one.
     *
     * <p>Both operands are non-negative, so {@code time - now} cannot overflow.
     */
    static boolean isWithinHorizon(long now, long time) {
        return time > 0L && now >= 0L && time - now <= MAX_ALARM_HORIZON_MILLIS;
    }

    /**
     * Whether a reconcile pass has to write the pruned store back.
     *
     * <p>Two independent conditions force a rewrite, and comparing the two list sizes only sees
     * one of them.
     *
     * <p>Pruning is the obvious one: the retained set is smaller than what was loaded, so the
     * expired entries are still on disk.
     *
     * <p>A lossy load is the one that used to be missed. The loader silently skips any entry it
     * cannot use - a duplicate id, a non-numeric time, a disabled flag, an entry past the
     * definition cap - so a store that lost entries on load no longer matches its own
     * serialised form. Comparing {@code loadedCount} against {@code persistedCount} catches
     * that, where comparing {@code loadedCount} against {@code armableCount} reported such a
     * store as clean, skipped the write, and left the app permanently forgetting the alarms the
     * loader had dropped. A store that failed to parse reports {@code persistedCount < 0},
     * which differs from any real count and so schedules the rewrite that replaces the corrupt
     * blob with a clean one.
     */
    static boolean shouldRewriteStore(int persistedCount, int loadedCount, int armableCount) {
        return persistedCount != loadedCount || loadedCount != armableCount;
    }

    /**
     * The definitions that are still worth arming: everything the store holds except entries
     * that have expired or that sit beyond the horizon. An expired entry is one the system would
     * only ever cancel, so dropping it changes no behaviour and keeps the store from filling up.
     */
    static List<AlarmDefinition> retainArmable(List<AlarmDefinition> definitions, long now) {
        List<AlarmDefinition> armable = new ArrayList<>();
        if (definitions == null) {
            return armable;
        }
        for (AlarmDefinition definition : definitions) {
            if (definition != null && isValidAlarmTime(now, definition.time)) {
                armable.add(definition);
            }
        }
        return armable;
    }

    /**
     * Notification and activity text is copied into a PendingIntent that the system server
     * keeps on the app's behalf, so an unbounded string from the bridge is a binder-size
     * hazard as well as a layout hazard.
     */
    static String sanitizeText(String value, String fallback, int maxLength) {
        String resolved = value == null || value.isEmpty() ? fallback : value;
        if (resolved == null || maxLength <= 0) {
            return "";
        }
        return resolved.length() <= maxLength ? resolved : truncate(resolved, maxLength);
    }

    /**
     * Truncates on a code-point boundary.
     *
     * <p>{@code String.substring} cuts UTF-16 code units, so a limit that lands between the two
     * halves of a surrogate pair yields a lone surrogate. That is not a character, and it does
     * not survive the round trip through a {@code Bundle} to the system server as the same
     * string, so the far end can be handed text the app never wrote. Dropping the half pair
     * costs one code point from an already truncated, purely cosmetic string.
     */
    private static String truncate(String value, int maxLength) {
        // value.length() > maxLength here, so both indices below are in range.
        if (Character.isHighSurrogate(value.charAt(maxLength - 1))
                && Character.isLowSurrogate(value.charAt(maxLength))) {
            return value.substring(0, maxLength - 1);
        }
        return value.substring(0, maxLength);
    }

    /**
     * Every PendingIntent this app creates is immutable. From API 31 (S) mutability is mandatory
     * rather than optional, and the minimum supported level is already 24, so there is no level
     * left on which the flag could be omitted. Immutability also matters for the broadcast
     * token: {@code AlarmClockInfo} exposes its show intent to any app that can read the next
     * alarm, and an immutable token cannot be filled in with someone else's extras.
     */
    static int immutablePendingIntentFlag() {
        return PendingIntent.FLAG_IMMUTABLE;
    }

    /**
     * The ids held by {@code existing} that {@code incoming} does not mention. This is the
     * whole cancel-all rule of {@link #syncAlarms}: an id absent from the incoming store is
     * removed, everything else is left alone.
     */
    static Set<Integer> idsToCancel(
            List<AlarmDefinition> existing,
            List<AlarmDefinition> incoming
    ) {
        Set<Integer> kept = new HashSet<>();
        if (incoming != null) {
            for (AlarmDefinition definition : incoming) {
                kept.add(definition.id);
            }
        }
        Set<Integer> cancelled = new HashSet<>();
        if (existing != null) {
            for (AlarmDefinition definition : existing) {
                if (!kept.contains(definition.id)) {
                    cancelled.add(definition.id);
                }
            }
        }
        return cancelled;
    }

    private static void scheduleDefinition(Context context, AlarmDefinition definition) {
        if (definition.time <= System.currentTimeMillis()) {
            cancelAlarmInternal(context, definition.id);
            return;
        }

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            throw new IllegalStateException("Alarm service unavailable");
        }

        PendingIntent pendingIntent = createAlarmPendingIntent(context, definition);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()) {
            try {
                // The two PendingIntents must differ: AlarmClockInfo's show intent is what the
                // system fires when the user taps the next-alarm affordance on the lock screen or
                // the status bar, and it is documented as "an intent that can be used to show or
                // edit details of the alarm clock". Pointing it at the alarm broadcast would
                // deliver the alarm out of schedule, so it opens the app instead.
                alarmManager.setAlarmClock(
                        new AlarmManager.AlarmClockInfo(
                                definition.time,
                                createShowPendingIntent(context, definition)
                        ),
                        pendingIntent
                );
                return;
            } catch (SecurityException exception) {
                // The permission can be revoked between the check and the call.
                logFailure("Setting the exact alarm", exception);
            }
        } else {
            Log.w(TAG, "Exact alarms are not granted; the alarm will be inexact");
        }

        // setAndAllowWhileIdle is inexact and needs no permission, so it is always available. It
        // is not a like-for-like substitute: without the exact-alarm grant the platform is free
        // to defer it inside a batching window, so a due alarm can be delivered late rather than
        // dropped. That is strictly better than no alarm at all.
        alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                definition.time,
                pendingIntent
        );
    }

    private static PendingIntent createAlarmPendingIntent(Context context, AlarmDefinition definition) {
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION_ALARM);
        // The shared keys, not literals: AlarmReceiver reads these names back out of the token
        // the system server hands it, and the same names carry the notification's content
        // intent. Renaming one copy only would leave a ringing alarm with no title.
        intent.putExtra(AlarmNotifications.EXTRA_ID, definition.id);
        intent.putExtra(AlarmNotifications.EXTRA_TITLE, definition.title);
        intent.putExtra(AlarmNotifications.EXTRA_BODY, definition.body);
        return PendingIntent.getBroadcast(
                context,
                definition.id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | immutablePendingIntentFlag()
        );
    }

    /**
     * The "show" half of {@link AlarmManager.AlarmClockInfo}. It targets a different component
     * from the alarm broadcast, so sharing the request code cannot make the two tokens collide.
     */
    private static PendingIntent createShowPendingIntent(Context context, AlarmDefinition definition) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(ACTION_SHOW_ALARM);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                context,
                definition.id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | immutablePendingIntentFlag()
        );
    }

    /**
     * Fully retires one alarm: the scheduled alarm, any ringing notification, and the ringing
     * activity. Used by both the single and the bulk cancel paths so they cannot diverge.
     */
    private static void disarmAlarm(Context context, int id) {
        cancelAlarmInternal(context, id);
        AlarmNotifications.cancel(context, id);
        AlarmActivity.stopAlarm(id);
    }

    private static void cancelAlarmInternal(Context context, int id) {
        if (!isValidAlarmId(id)) {
            return;
        }
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }

        // PendingIntent identity ignores extras, so the same id always resolves to the token
        // that createAlarmPendingIntent registered and the alarm can be cancelled directly.
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION_ALARM);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                id,
                intent,
                PendingIntent.FLAG_NO_CREATE | immutablePendingIntentFlag()
        );
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent);
            pendingIntent.cancel();
        }
        // Cancelling the alarm drops the platform's reference to AlarmClockInfo, but the show
        // token itself would stay registered in the system's pending-intent table until the
        // process dies, so it is retired alongside the alarm it belonged to.
        cancelPendingIntent(context, new Intent(context, MainActivity.class), id);
    }

    private static void cancelPendingIntent(Context context, Intent intent, int id) {
        intent.setAction(ACTION_SHOW_ALARM);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                id,
                intent,
                PendingIntent.FLAG_NO_CREATE | immutablePendingIntentFlag()
        );
        if (pendingIntent != null) {
            pendingIntent.cancel();
        }
    }

    private static Integer readId(PluginCall call) {
        if (call == null || call.getData() == null) {
            return null;
        }
        return exactId(call.getData().opt("id"));
    }

    private static Long readTimestamp(PluginCall call) {
        if (call == null || call.getData() == null) {
            return null;
        }
        return exactTimestamp(call.getData().opt("time"));
    }

    private static String readString(PluginCall call, String key, String defaultValue) {
        if (call == null || call.getData() == null) {
            return defaultValue;
        }
        Object value = call.getData().opt(key);
        if (value == null || value == JSONObject.NULL || !(value instanceof String)) {
            return defaultValue;
        }
        return (String) value;
    }

    static Long exactLong(Object raw) {
        if (!(raw instanceof Number)) {
            return null;
        }
        try {
            return new BigDecimal(raw.toString()).longValueExact();
        } catch (NumberFormatException | ArithmeticException exception) {
            return null;
        }
    }

    private static List<AlarmDefinition> parseDefinitions(Object raw) {
        if (!(raw instanceof JSONArray)) {
            throw new IllegalArgumentException("alarms must be an array");
        }

        JSONArray array = (JSONArray) raw;
        List<AlarmDefinition> definitions = new ArrayList<>();
        Set<Integer> ids = new HashSet<>();
        long now = System.currentTimeMillis();
        for (int index = 0; index < array.length(); index++) {
            Object item = array.opt(index);
            if (!(item instanceof JSONObject)) {
                throw new IllegalArgumentException("Each alarm must be an object");
            }
            JSONObject object = (JSONObject) item;
            if (object.has("enabled") && !object.optBoolean("enabled", true)) {
                continue;
            }

            Integer id = exactId(object.opt("id"));
            Long time = exactTimestamp(object.opt("time"));
            if (id == null || time == null) {
                throw new IllegalArgumentException("Each alarm must have a valid id and time");
            }
            if (!ids.add(id)) {
                throw new IllegalArgumentException("Alarm ids must be unique");
            }
            if (!isWithinHorizon(now, time)) {
                // Past times are allowed through: an alarm that fired a moment ago is a normal
                // entry, and scheduleDefinition simply disarms it. A time beyond the horizon is
                // not, which is why scheduleAlarm refuses one and this has to agree.
                throw new IllegalArgumentException(
                        "Each alarm must be within the supported horizon"
                );
            }
            if (definitions.size() >= MAX_DEFINITIONS) {
                throw new IllegalArgumentException("At most " + MAX_DEFINITIONS + " alarms can be armed");
            }

            definitions.add(new AlarmDefinition(
                    id,
                    time,
                    sanitizeText(objectString(object, "title", DEFAULT_TITLE), DEFAULT_TITLE, MAX_TITLE_LENGTH),
                    sanitizeText(objectString(object, "body", DEFAULT_BODY), DEFAULT_BODY, MAX_BODY_LENGTH)
            ));
        }
        return definitions;
    }

    private static StoredDefinitions loadDefinitions(Context context) {
        String serialized = readSerializedDefinitions(context);
        if (serialized == null || serialized.isEmpty()) {
            return StoredDefinitions.empty();
        }

        List<AlarmDefinition> definitions = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(serialized);
            Set<Integer> ids = new HashSet<>();
            for (int index = 0; index < array.length() && definitions.size() < MAX_DEFINITIONS; index++) {
                Object item = array.opt(index);
                if (!(item instanceof JSONObject)) {
                    continue;
                }
                JSONObject object = (JSONObject) item;
                if (object.has("enabled") && !object.optBoolean("enabled", true)) {
                    continue;
                }
                Integer id = exactId(object.opt("id"));
                Long time = exactTimestamp(object.opt("time"));
                if (id == null || time == null || !ids.add(id)) {
                    continue;
                }
                definitions.add(new AlarmDefinition(
                        id,
                        time,
                        sanitizeText(objectString(object, "title", DEFAULT_TITLE), DEFAULT_TITLE, MAX_TITLE_LENGTH),
                        sanitizeText(objectString(object, "body", DEFAULT_BODY), DEFAULT_BODY, MAX_BODY_LENGTH)
                ));
            }
            if (array.length() > MAX_DEFINITIONS) {
                Log.w(TAG, "Alarm store holds " + array.length() + " entries; at most "
                        + MAX_DEFINITIONS + " were loaded");
            }
            return new StoredDefinitions(definitions, array.length());
        } catch (JSONException | IllegalArgumentException exception) {
            logFailure("Loading alarms", exception);
            // The count is reported as unknown so {@link #shouldRewriteStore} treats the blob as
            // unusable and lets a reconcile pass replace it with a well-formed store.
            return new StoredDefinitions(definitions, UNPARSED_STORE);
        }
    }

    private static String readSerializedDefinitions(Context context) {
        if (context == null) {
            return null;
        }
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return preferences.getString(PREF_DEFINITIONS, null);
    }

    private static void persistDefinitions(
            Context context,
            List<AlarmDefinition> definitions
    ) throws JSONException {
        JSONArray array = new JSONArray();
        for (AlarmDefinition definition : definitions) {
            JSONObject object = new JSONObject();
            object.put("id", definition.id);
            object.put("time", definition.time);
            object.put("title", definition.title);
            object.put("body", definition.body);
            object.put("enabled", true);
            array.put(object);
        }
        // commit() is deliberate: the store is the only record that survives a reboot, and a
        // boot receiver cannot observe an apply()-deferred write.
        boolean committed = context
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_DEFINITIONS, array.toString())
                .commit();
        if (!committed) {
            throw new IllegalStateException("Unable to persist alarms");
        }
    }

    /**
     * The single id gate used by the bridge, the store and the alarm receiver, so a value that
     * would be rejected on the way in can never be accepted on the way out. Package-private
     * because {@link AlarmReceiver} reads the id back out of a broadcast through this too.
     */
    static Integer exactId(Object raw) {
        Long value = exactLong(raw);
        if (value == null || value < 1 || value > MAX_ALARM_ID) {
            return null;
        }
        return value.intValue();
    }

    private static Long exactTimestamp(Object raw) {
        Long value = exactLong(raw);
        if (value == null || value <= 0) {
            return null;
        }
        return value;
    }

    private static String objectString(JSONObject object, String key, String defaultValue) {
        Object value = object.opt(key);
        if (value == null || value == JSONObject.NULL || !(value instanceof String)) {
            return defaultValue;
        }
        return (String) value;
    }

    /**
     * Replaces the definition that shares the id, or appends a new one. Returns false when the
     * store is already at {@link #MAX_DEFINITIONS} so the caller can refuse instead of arming
     * an alarm it would not be able to record.
     */
    private static boolean upsertDefinition(
            List<AlarmDefinition> definitions,
            AlarmDefinition replacement
    ) {
        for (int index = 0; index < definitions.size(); index++) {
            if (definitions.get(index).id == replacement.id) {
                definitions.set(index, replacement);
                return true;
            }
        }
        if (definitions.size() >= MAX_DEFINITIONS) {
            return false;
        }
        definitions.add(replacement);
        return true;
    }

    private static void removeDefinition(List<AlarmDefinition> definitions, int id) {
        for (int index = definitions.size() - 1; index >= 0; index--) {
            if (definitions.get(index).id == id) {
                definitions.remove(index);
            }
        }
    }

    private static void logFailure(String operation, Exception exception) {
        Log.e(TAG, operation + " failed (" + exception.getClass().getSimpleName() + ")");
    }

    /**
     * A sentinel for a store whose serialised form could not be parsed at all. It is negative so
     * it can never collide with a real {@code JSONArray} length, which keeps
     * {@link #shouldRewriteStore} correct without a separate "unparseable" branch.
     */
    static final int UNPARSED_STORE = -1;

    /**
     * What one read of the persisted store produced: the definitions that survived, and how
     * many entries the serialised form actually held. The second number is what makes a lossy
     * read detectable, since the surviving list alone cannot show what was dropped.
     */
    static final class StoredDefinitions {

        private final List<AlarmDefinition> definitions;
        private final int persistedCount;

        private StoredDefinitions(List<AlarmDefinition> definitions, int persistedCount) {
            this.definitions = definitions;
            this.persistedCount = persistedCount;
        }

        static StoredDefinitions empty() {
            return new StoredDefinitions(new ArrayList<AlarmDefinition>(), 0);
        }

        List<AlarmDefinition> definitions() {
            return definitions;
        }

        int persistedCount() {
            return persistedCount;
        }
    }

    static final class AlarmDefinition {

        private final int id;
        private final long time;
        private final String title;
        private final String body;

        AlarmDefinition(int id, long time, String title, String body) {
            this.id = id;
            this.time = time;
            this.title = title;
            this.body = body;
        }

        int id() {
            return id;
        }

        long time() {
            return time;
        }

        String title() {
            return title;
        }

        String body() {
            return body;
        }
    }
}
