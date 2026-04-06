# Bug Fix Plan - Daily Study Tracker

## Issue #1: `exportData` returns meaningless count (DataProvider.tsx:135-147)

**Problem:** `Object.values(data).flat().length` counts total items across all arrays, not days. The toast says "X days exported" but shows a meaningless number.

**Fix:**
```tsx
// BEFORE (line 135-147):
const exportData = useCallback((): number => {
    const data = { subjects, checklistItems, qualityChecks, dayRating, errors, todos };
    const count = Object.values(data).flat().length;
    downloadBackup();
    return count;
}, [subjects, checklistItems, qualityChecks, dayRating, errors, todos]);

// AFTER:
const exportData = useCallback(async (): Promise<number> => {
    const count = await downloadBackup();
    return count;
}, []);
```

Also update `DataProviderValue` type (`types/index.ts:144`):
```tsx
exportData: () => Promise<number>;
```

And update the handler in `App.tsx:430-437`:
```tsx
const handleExport = useCallback(async () => {
    try {
        const count = await exportData();
        showToast({ type: 'success', message: `Backup downloaded! ${count} days exported.` });
    } catch {
        showToast({ type: 'error', message: 'Export failed. Please try again.' });
    }
}, [exportData, showToast]);
```

---

## Issue #2: `ErrorLog.removeError` filters by index, not id (ErrorLog.tsx:84-87)

**Problem:** Items are keyed by `error.id` in the map (line 114), but `removeError` filters by array index. This causes React to mismatch keyed elements after deletion.

**Fix:**
```tsx
// BEFORE (line 84-87):
const removeError = useCallback(
    (index: number) => {
        setErrors((prev) => prev.filter((_, i) => i !== index));
    },
    [setErrors],
);

// AFTER:
const removeError = useCallback(
    (id: number) => {
        setErrors((prev) => prev.filter((err) => err.id !== id));
    },
    [setErrors],
);
```

Update the call site in the render (line 119):
```tsx
// BEFORE:
onRemove={() => removeError(index)}
// AFTER:
onRemove={() => removeError(error.id)}
```

---

## Issue #3 & #17: CountdownTimer useEffect re-runs every second (CountdownTimer.tsx:106-188)

**Problem:** `timeLeft` is in the dependency array, causing the entire effect (including foreground service calls, interval setup/teardown) to run every second.

**Fix:** Refactor to use a ref-based approach. The interval should only be set up when `isActive` changes, and use `endTimeRef` to compute remaining time without depending on `timeLeft`.

```tsx
// Replace the entire useEffect (lines 106-188) with:
useEffect(() => {
    const manageServices = async () => {
        if (isActive) {
            await KeepAwake.keepAwake();
            if (Capacitor.getPlatform() === 'android') {
                try {
                    const status = await ForegroundService.checkPermissions();
                    if (status.display !== 'granted') {
                        const request = await ForegroundService.requestPermissions();
                        if (request.display !== 'granted') return;
                    }
                    const overlayStatus = await ForegroundService.checkManageOverlayPermission();
                    if (!overlayStatus.granted) {
                        await ForegroundService.requestManageOverlayPermission().catch(() => {});
                    }
                    await ForegroundService.startForegroundService({
                        id: 111,
                        title: 'Focus Timer',
                        body: `Time remaining: ${formatTimeDisplay(timeLeft)}`,
                        smallIcon: 'ic_timer_icon',
                        serviceType: 1073741824 as never,
                        silent: true,
                    });
                } catch (_e) {}
            }
        } else {
            await KeepAwake.allowSleep();
            if (Capacitor.getPlatform() === 'android') {
                try {
                    await ForegroundService.stopForegroundService();
                } catch (_e) {}
            }
        }
    };

    manageServices();

    if (isActive) {
        intervalRef.current = window.setInterval(() => {
            if (!endTimeRef.current) return;
            const now = Date.now();
            const remaining = Math.max(0, Math.ceil((endTimeRef.current - now) / 1000));
            setTimeLeft(remaining);
            if (remaining <= 0) {
                if (intervalRef.current) clearInterval(intervalRef.current);
                setIsActive(false);
                playAlarm();
            } else {
                if (Capacitor.getPlatform() === 'android') {
                    ForegroundService.updateForegroundService({
                        id: 111,
                        title: 'Focus Timer',
                        body: `Time remaining: ${formatTimeDisplay(remaining)}`,
                        smallIcon: 'ic_timer_icon',
                        silent: true,
                    }).catch(() => {});
                }
            }
        }, 1000);
    }

    return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        KeepAwake.allowSleep();
    };
}, [isActive, playAlarm, formatTimeDisplay]);
```

Also remove `formatTimeDisplay` from the dependency array by wrapping it in `useCallback` (it already is, so just remove it from the deps of the effect and use a ref for the current value).

Actually, `formatTimeDisplay` is already `useCallback` with empty deps (line 95-104), so it's stable. The key change is removing `timeLeft` from deps.

---

## Issue #4: `setTodos` recreated every render causes notification listener re-init (App.tsx:387)

**Problem:** `wrapSet(setTodosState)` in DataProvider creates a new function every render. The `useEffect` in App.tsx (line 362-407) depends on `setTodos`, causing notification listeners to be re-registered constantly.

**Fix in DataProvider.tsx:** Memoize the wrapped setters using `useMemo` or `useCallback`:

```tsx
// Add at the top of DataProvider component (after state declarations):
const setSubjectsWrapped = useCallback(
    (updater: Subject[] | ((prev: Subject[]) => Subject[])) => {
        setSubjectsState(updater);
        setHasUnsavedChanges(true);
    },
    [],
);

const setChecklistItemsWrapped = useCallback(
    (updater: ChecklistItem[] | ((prev: ChecklistItem[]) => ChecklistItem[])) => {
        setChecklistItemsState(updater);
        setHasUnsavedChanges(true);
    },
    [],
);

const setQualityChecksWrapped = useCallback(
    (updater: QualityCheckItem[] | ((prev: QualityCheckItem[]) => QualityCheckItem[])) => {
        setQualityChecksState(updater);
        setHasUnsavedChanges(true);
    },
    [],
);

const setErrorsWrapped = useCallback(
    (updater: ErrorLogEntry[] | ((prev: ErrorLogEntry[]) => ErrorLogEntry[])) => {
        setErrorsState(updater);
        setHasUnsavedChanges(true);
    },
    [],
);

const setTodosWrapped = useCallback(
    (updater: Todo[] | ((prev: Todo[]) => Todo[])) => {
        setTodosState(updater);
        setHasUnsavedChanges(true);
    },
    [],
);
```

Then in the value object:
```tsx
setSubjects: setSubjectsWrapped,
setChecklistItems: setChecklistItemsWrapped,
setQualityChecks: setQualityChecksWrapped,
setErrors: setErrorsWrapped,
setTodos: setTodosWrapped,
```

Remove the `wrapSet` helper function entirely.

---

## Issue #5: Day indicators shifted by one day (TrackerForm.tsx:440-453)

**Problem:** `DAYS` array: Sunday=0, Monday=1, ... Saturday=6. But display array `['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']` maps Mon→0, Tue→1, etc. So Monday is checked against `recurringDays` index 0 (which is Sunday).

**Fix:**
```tsx
// BEFORE (line 441):
{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayLabel, dayIdx) => {
    const isActive = subject.recurring && subject.recurringDays?.includes(dayIdx);

// AFTER:
const DAY_DISPLAY = [
    { label: 'Sun', value: 0 },
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thu', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 },
];
{DAY_DISPLAY.map((day) => {
    const isActive = subject.recurring && subject.recurringDays?.includes(day.value);
    return (
        <span key={day.value} className={...}>
            {day.label}
        </span>
    );
})}
```

---

## Issue #6: StudyCharts SubjectProgressBar uses `subject.name` as key (StudyCharts.tsx:198)

**Problem:** Duplicate subject names cause React to reuse components incorrectly.

**Fix:**
```tsx
// BEFORE (line 197-203):
{subjects.map((subject, i) => (
    <SubjectProgressBar
        key={subject.name}
        ...

// AFTER:
{subjects.map((subject, i) => (
    <SubjectProgressBar
        key={`${subject.name}-${i}`}
        ...
```

Also fix the legend (line 211-212):
```tsx
// BEFORE:
{stats.subjectStats.map((s) => (
    <div key={s.name} ...

// AFTER:
{stats.subjectStats.map((s, i) => (
    <div key={`${s.name}-${i}`} ...
```

---

## Issue #7: CountdownTimer gain value too loud (CountdownTimer.tsx:68)

**Problem:** Gain of 5.0 can cause audio distortion and hearing damage.

**Fix:**
```tsx
// BEFORE (line 68):
gainNodeRef.current.gain.value = 5.0;

// AFTER:
gainNodeRef.current.gain.value = 1.5;
```

---

## Issue #8: Update check runs on every date change (App.tsx:392-398)

**Problem:** `checkForUpdate` is inside the effect that depends on `date`, so it runs every time the user navigates to a different date.

**Fix:** Move to a separate `useEffect` with empty dependency array:
```tsx
// Add a new useEffect in App component:
useEffect(() => {
    import('./utils/checkForUpdate').then(({ checkForUpdate }) => {
        checkForUpdate().then((info) => {
            if (info?.available) {
                showToast({ type: 'info', message: `Update available: ${info.tag ?? ''}` });
            }
        });
    });
}, [showToast]);
```

And remove the checkForUpdate call from the existing effect (lines 392-398).

---

## Issue #9: generateId collision across tabs (DataProvider.tsx:23-24)

**Problem:** `let nextId = Date.now()` starts at similar values in different tabs, causing ID collisions.

**Fix:**
```tsx
// BEFORE:
let nextId = Date.now();
const generateId = () => ++nextId;

// AFTER:
let nextId = Date.now();
const tabSuffix = Math.floor(Math.random() * 10000);
const generateId = () => {
    nextId += 1;
    return parseInt(`${nextId}${tabSuffix}`.slice(0, 15), 10);
};
```

Or simpler and safer:
```tsx
const generateId = () => Date.now() + Math.floor(Math.random() * 10000);
```

---

## Issue #10: RecurringModal initialDays state doesn't update (TrackerForm.tsx:27)

**Problem:** `useState(initialDays || [0,1,2,3,4,5,6])` only reads initial value. Opening modal for different subjects shows stale days.

**Fix:**
```tsx
// Add useEffect to sync:
useEffect(() => {
    if (isOpen) {
        setSelectedDays(initialDays || [0, 1, 2, 3, 4, 5, 6]);
    }
}, [isOpen, initialDays]);
```

---

## Issue #11: TodoPage setTodos uses stale closures (TodoPage.tsx:22,73,90)

**Problem:** `setTodos([newTodo, ...todos])` captures `todos` in closure. Rapid updates can lose data.

**Fix:** Use updater functions everywhere:
```tsx
// Line 22:
setTodos((prev) => [newTodo, ...prev]);

// Line 27-35 (toggleTodo):
setTodos((prev) =>
    prev.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
);

// Line 42 (deleteTodo):
setTodos((prev) => prev.filter((t) => t.id !== id));

// Line 46-58 (handleTimeChange):
setTodos((prev) =>
    prev.map((todo) => {
        if (todo.id === id) {
            const updatedTodo: Todo = { ...todo, time: newTime };
            if (todo.reminder) {
                NotificationService.cancelNotification(id);
                updatedTodo.reminder = false;
            }
            return updatedTodo;
        }
        return todo;
    }),
);

// Line 73 (handleReminder - cancel):
setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, reminder: false } : t)));

// Line 90 (handleReminder - schedule):
setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, reminder: true } : t)));
```

---

## Issue #12: pdfGenerator error log not sanitized (pdfGenerator.ts:121)

**Problem:** Error log fields passed to PDF without sanitization.

**Fix:**
```tsx
// BEFORE (line 119-121):
const errorBody = errors
    .filter((e) => e.question || e.mistake || e.correctLogic)
    .map((e) => [e.question, e.mistake, e.correctLogic]);

// AFTER:
const errorBody = errors
    .filter((e) => e.question || e.mistake || e.correctLogic)
    .map((e) => [sanitizeText(e.question), sanitizeText(e.mistake), sanitizeText(e.correctLogic)]);
```

---

## Issue #13: InbuiltAlarm parseInt for large IDs (InbuiltAlarm.tsx:45,58,77,102)

**Problem:** `Date.now().toString()` produces 13-digit numbers. `parseInt` works but Android alarm IDs are 32-bit int (max 2,147,483,647). A 13-digit timestamp will overflow.

**Fix:** Use a smaller ID scheme:
```tsx
// Change the AlarmEntry id generation:
const addAlarm = () => {
    const newAlarm: AlarmEntry = {
        id: `${Math.floor(Math.random() * 9000) + 1000}`,
        time: '08:00',
        active: false,
    };
    setAlarms([...alarms, newAlarm]);
};
```

And update all `parseInt(id, 10)` calls to use the NotificationService.safeId:
```tsx
import { NotificationService } from '../utils/notificationService';

// In removeAlarm, updateAlarmTime, toggleAlarm:
const nativeId = NotificationService.safeId(id);
await NativeAlarm.cancelAlarm({ id: nativeId });
```

---

## Issue #14: importData fallback logic (DataProvider.tsx:162-166)

**Problem:** Empty arrays `[]` are truthy, so `||` fallback never triggers.

**Fix:** This is actually correct behavior — if the imported file has empty arrays, we should save empty arrays, not fall back to current state. No change needed.

---

## Issue #15: notificationService safeId collisions (notificationService.ts:6-15)

**Problem:** The hash function can produce collisions for similar numeric IDs.

**Fix:** Use a more robust approach:
```tsx
safeId(id: string | number): number {
    const strId = String(id);
    // Use a simple but more distributed hash
    let hash = 5381;
    for (let i = 0; i < strId.length; i++) {
        hash = ((hash << 5) + hash) ^ strId.charCodeAt(i);
    }
    // Ensure positive 32-bit integer suitable for Android notification ID
    return Math.abs(hash) & 0x7fffffff;
},
```

---

## Issue #16: CountdownTimer toggleTimer race condition (CountdownTimer.tsx:243)

**Problem:** When pausing, `endTimeRef.current` could be `null` if effect hasn't run yet.

**Fix:**
```tsx
// Line 243:
const remaining = Math.max(0, Math.ceil(((endTimeRef.current ?? Date.now()) - Date.now()) / 1000));
```

Actually, if `endTimeRef.current` is null, the timer hasn't started yet, so this case shouldn't happen in practice. But adding a guard:
```tsx
} else if (isActive) {
    if (!endTimeRef.current) {
        setIsActive(false);
        return;
    }
    const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
```

---

## Issue #18: StudyCharts pie chart label clarity

**Problem:** Pie chart shows subject time distribution but center shows completion rate — two different metrics.

**Fix:** Change the center label to clarify what it shows:
```tsx
// Line 152-156:
<div className="text-center">
    <div className="text-lg font-bold text-app-text-main">
        {stats.completionRate}%
    </div>
    <div className="text-[10px] text-app-text-muted">Complete</div>
</div>
```

---

## Issue #19: InbuiltAlarm localStorage on native

**Problem:** On native platforms, alarms stored in localStorage but other data uses Filesystem.

**Fix:** Add Capacitor Filesystem persistence for native:
```tsx
useEffect(() => {
    const loadAlarms = async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem');
                const result = await Filesystem.readFile({
                    path: 'focus-alarms.json',
                    directory: Directory.Data,
                    encoding: Encoding.UTF8,
                });
                setAlarms(JSON.parse(result.data as string) as AlarmEntry[]);
                return;
            } catch {}
        }
        const savedAlarms = localStorage.getItem('focusAlarms');
        if (savedAlarms) {
            try {
                setAlarms(JSON.parse(savedAlarms) as AlarmEntry[]);
            } catch {
                setAlarms([]);
            }
        }
    };
    loadAlarms();
}, []);

useEffect(() => {
    const saveAlarms = async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem');
                await Filesystem.writeFile({
                    path: 'focus-alarms.json',
                    data: JSON.stringify(alarms),
                    directory: Directory.Data,
                    encoding: Encoding.UTF8,
                });
                return;
            } catch {}
        }
        localStorage.setItem('focusAlarms', JSON.stringify(alarms));
    };
    saveAlarms();
}, [alarms]);
```

---

## Issue #20: ThemeProvider class cleanup

**Problem:** When switching from `'adaptive'` to other themes, CSS variables are removed correctly. But `'light'` theme doesn't add any class — it relies on default CSS. This is actually correct behavior since light is the default. No fix needed.

However, there's a minor issue: when switching from `'material-light'` or `'material-dark'` to `'light'`, the material classes are correctly removed. But the `useEffect` at line 212 only runs when `effectiveTheme` changes, not when the stored `theme` changes from `'material-light'` to `'adaptive'` (which has `effectiveTheme = 'adaptive'`). This is fine since `effectiveTheme` does change.

No fix needed for this issue.
