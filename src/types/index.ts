import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Core Domain Types
// ---------------------------------------------------------------------------

export interface Subject {
    id: number;
    name: string;
    planned: string;
    actual: string;
    kpi: string;
    time: string;
    reminder: boolean;
    /**
     * Must be accompanied by `recurringDays`; storage rejects `recurring: true` without it. An
     * empty `recurringDays` is accepted but is not a template - see {@link RecurringSubject}.
     */
    recurring?: boolean;
    /** Day indices 0-6, deduplicated and sorted. An empty list is *not* a valid template. */
    recurringDays?: number[];
}

export interface ChecklistItem {
    id: number;
    label: string;
    checked: boolean;
}

export interface QualityCheckItem {
    id: number;
    label: string;
    checked: boolean;
}

export interface ErrorLogEntry {
    id: number;
    question: string;
    mistake: string;
    correctLogic: string;
}

export interface Todo {
    id: number;
    text: string;
    completed: boolean;
    time: string;
    reminder: boolean;
}

export interface DayData {
    date: string;
    updatedAt: string;
    subjects: Subject[];
    checklistItems: ChecklistItem[];
    qualityChecks: QualityCheckItem[];
    dayRating: string;
    errors: ErrorLogEntry[];
}

/**
 * A subject that is repeated on a set of weekdays. The storage validators additionally
 * require a non-empty `recurringDays`; the field is typed as `number[]` because that
 * invariant is enforced on write, not by the compiler.
 */
export interface RecurringSubject extends Subject {
    recurring: true;
    recurringDays: number[];
}

export interface FocusAlarm {
    id: string;
    time: string;
    active: boolean;
    nativeId?: number;
}

export interface BackupSettings {
    theme: ThemeValue;
    adaptiveColor: string | null;
}

/**
 * The four non-day sections, named as keys.
 *
 * Every one of them is stored and imported as a unit, so the recency stamp has to
 * be per-section: a user who edits their theme and their todo list seconds apart
 * must not have one of the two edits decided by which section happened to be
 * written last.
 */
export type GlobalSectionKey = 'recurringSubjects' | 'todos' | 'focusAlarms' | 'settings';

/**
 * When each global section was last written, as an ISO timestamp.
 *
 * A section with no stamp is one whose recency this build cannot know: a backup
 * written before the stamps existed, or a store a pre-metadata build left behind.
 * That is *not* the same as "written at the epoch", and the import policy treats
 * the two differently - see `shouldApplyGlobalSection` in `src/services/storage.ts`.
 */
export type GlobalSectionStamps = Partial<Record<GlobalSectionKey, string>>;

/**
 * The current on-disk/backup shape only. The parser additionally accepts two legacy roots - a
 * bare `DayData[]` and a single `DayData` - and normalises them into this envelope, so
 * `BackupEnvelope` deliberately cannot represent an accepted *input*.
 *
 * `globalStamps` is always present and always an object here, possibly empty. A
 * file that omits it is still accepted - every backup taken before this field
 * existed is - and normalises to `{}`, which is what makes an unstamped section
 * mean "unknown" rather than "absent".
 */
export interface BackupEnvelope {
    schemaVersion: number;
    exportedAt: string;
    days: DayData[];
    recurringSubjects: RecurringSubject[];
    todos: Todo[];
    focusAlarms: FocusAlarm[];
    settings: BackupSettings;
    globalStamps: GlobalSectionStamps;
}

// ---------------------------------------------------------------------------
// Theme Types
// ---------------------------------------------------------------------------

export type ThemeValue = 'light' | 'dark' | 'auto' | 'material-light' | 'material-dark' | 'adaptive';

export interface ThemeContextValue {
    theme: ThemeValue;
    setTheme: (newTheme: ThemeValue) => void;
    effectiveTheme: string;
    pickAdaptiveColor: () => Promise<{ color: string; palette: Record<number, string> } | null>;
}

export interface ThemeOption {
    readonly value: ThemeValue;
    readonly label: string;
    readonly icon: React.ComponentType<{ size?: number; className?: string }>;
    readonly description: string;
}

// ---------------------------------------------------------------------------
// Toast Types
// ---------------------------------------------------------------------------

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
    id: string;
    type: ToastType;
    message: string;
    duration: number;
}

export interface ToastContextValue {
    showToast: (options: { type: ToastType; message: string; duration?: number }) => void;
    dismissToast: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Notification / Update Types
// ---------------------------------------------------------------------------

/**
 * A published release, as returned by the update service. The asset triple is release metadata
 * the download then verifies against; `UpdateInstallResult` in the update service is the
 * *outcome* of an install attempt and reuses the same field names for a different purpose.
 */
export interface UpdateResult {
    available: boolean;
    tag?: string;
    url?: string;
    notes?: string;
    assetName?: string;
    sha256?: string;
    size?: number;
}

/**
 * The minimal outcome every scheduling call shares; the update-free web/native split, the
 * inexact-alarm downgrade and the per-session flags are layered on by the notification service.
 */
export interface NotificationScheduleResult {
    success: boolean;
    error?: string;
}

// ---------------------------------------------------------------------------
// Data Context Types
// ---------------------------------------------------------------------------

export interface DataProviderProps {
    children: ReactNode;
}

export type DataValueSetter<T> = (updater: T | ((prev: T) => T)) => void;

export interface DataProviderValue {
    /** The selected day. */
    date: string;
    /**
     * The day the payload below was actually read from. `null` means "not loaded yet" (or
     * "load refused/failed"), which is deliberately distinct from `date`: consumers must not
     * treat state and store as coherent while these differ, so gate anything derived from the
     * payload (scheduled reminders) on `loadedDate === date`. A load only ever adopts a record
     * that names the day it was asked for, so a mismatch is reported rather than shown.
     */
    loadedDate: string | null;
    isInitialized: boolean;
    subjects: Subject[];
    checklistItems: ChecklistItem[];
    qualityChecks: QualityCheckItem[];
    dayRating: string;
    errors: ErrorLogEntry[];
    todos: Todo[];
    /** True while any change is not yet in the store. */
    hasUnsavedChanges: boolean;
    isSaving: boolean;
    /** Timestamp of the last write that actually reached the store, else `null`. */
    lastSaved: string | null;
    /**
     * Selects `newDate` and loads it, after persisting anything still pending under the
     * outgoing day. Resolves without doing anything when `newDate` is already selected and
     * loaded (or when the startup read for it is still in flight); rejects on an invalid key
     * or a failed save/load, leaving the previous selection intact.
     */
    setDate: (newDate: string) => Promise<void>;
    setSubjects: DataValueSetter<Subject[]>;
    setChecklistItems: DataValueSetter<ChecklistItem[]>;
    setQualityChecks: DataValueSetter<QualityCheckItem[]>;
    setDayRating: (val: string) => void;
    setErrors: DataValueSetter<ErrorLogEntry[]>;
    setTodos: DataValueSetter<Todo[]>;
    /**
     * Persists every pending change, sharing its write with an already running flush. Rejects
     * if the write failed (leaving the data dirty) or if an edit kept landing through every
     * drain pass, in which case the data is still dirty too. Waiting for another caller's
     * write is not one of those passes: a busy queue cannot make this call report a save
     * failure for a save that is being made.
     */
    saveData: () => Promise<void>;
    /** Drains pending changes, then returns the number of days in the backup. */
    exportData: () => Promise<number>;
    /**
     * Imports with the storage default conflict policy (`newest`) and returns the number of
     * applied day records: the file only wins for days it is newer for, so a restore never
     * discards local work recorded later. The `replace`/`keep` policies exist in storage but
     * are deliberately not reachable through this API.
     *
     * The day, the todo list and the recurring templates are re-read here, and the
     * component-owned mirrors (theme, focus alarms) are told to re-read as soon as the store
     * has been rewritten - so they refresh even if the reload that follows fails. A rejection
     * therefore means the screen may not reflect the restore, *not* that the file was refused:
     * `loadedDate` is left `null` in that case, and the store already holds what was applied.
     */
    importData: (file: File) => Promise<number>;
    downloadPDF: () => Promise<void>;
    downloadMD: () => Promise<void>;
    /**
     * The switch `setDate` performs, without its same-day short circuit - so it is also the
     * documented way to re-load a day whose previous load was refused. Rejects like it does.
     */
    loadDataForDate: (targetDate: string) => Promise<void>;
    /**
     * A fresh id for a subject, todo, checklist or error entry. Always a non-negative safe
     * integer - the shape storage accepts - and unique even for calls made in the same
     * millisecond, so two entities can never collapse into one row.
     */
    generateId: () => number;
}

// ---------------------------------------------------------------------------
// PDF / MD Generator Data
// ---------------------------------------------------------------------------

export interface ExportData {
    date: string;
    subjects: Subject[];
    checklistItems: ChecklistItem[];
    qualityChecks: QualityCheckItem[];
    dayRating: string;
    errors: ErrorLogEntry[];
    todos: Todo[];
}

// ---------------------------------------------------------------------------
// Component Prop Types
// ---------------------------------------------------------------------------

export interface AlarmPermissionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings: () => void;
}

export interface ChecklistProps {
    items: ChecklistItem[];
    setItems: DataValueSetter<ChecklistItem[]>;
}

export interface ChecklistItemProps {
    item: ChecklistItem;
    onToggle: () => void;
    onUpdateLabel: (label: string) => void;
    onRemove: () => void;
}

export interface DatePickerProps {
    date: string;
    setDate: (newDate: string) => void | Promise<void>;
    compact?: boolean;
}

export interface ErrorLogProps {
    errors: ErrorLogEntry[];
    setErrors: DataValueSetter<ErrorLogEntry[]>;
}

export interface ErrorLogItemProps {
    error: ErrorLogEntry;
    index: number;
    onUpdate: (field: keyof ErrorLogEntry, value: string) => void;
    onRemove: () => void;
}

/**
 * The alarm list on the focus route has no ringing UI of its own, and therefore no
 * props.
 *
 * The app shell is the single owner of the in-app ringing overlay (see
 * `src/app/App.tsx`). The overlay this card used to render keyed off a
 * `'FOCUS_ALARM'` action type that nothing ever registers with the plugin, so it
 * could only ever have appeared as a second, competing `aria-modal` dialog for one
 * alarm. Delivery itself is Android's: `AlarmReceiver` starts `AlarmActivity`,
 * which none of this affects.
 */
export type InbuiltAlarmProps = Record<string, never>;

export interface LayoutProps {
    children: ReactNode;
}

export interface QualityCheckProps {
    checks: QualityCheckItem[];
    setChecks: DataValueSetter<QualityCheckItem[]>;
    rating: string;
    setRating: (val: string) => void;
}

export interface QualityCheckItemCompProps {
    check: QualityCheckItem;
    onToggle: () => void;
    onUpdateLabel: (label: string) => void;
    onRemove: () => void;
}

export interface RatingOptionProps {
    option: string;
    isSelected: boolean;
    onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export interface StudyChartsProps {
    subjects: Subject[];
}

export interface ThemeSelectorProps {
    theme: ThemeValue;
    setTheme: (newTheme: ThemeValue) => void;
}

export interface TimePickerProps {
    value: string;
    onChange: (newTime: string) => void;
}

export interface TrackerFormProps {
    subjects: Subject[];
    setSubjects: DataValueSetter<Subject[]>;
}

export interface RecurringModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (days: number[]) => void;
    onStopRepeating: () => void;
    initialDays: number[];
    subjectName: string;
    isCurrentlyRecurring: boolean;
}

export interface UpdateModalProps {
    isOpen?: boolean;
    onClose: () => void;
    updateInfo?: UpdateResult | null;
    onRemindLater?: () => void;
}

export interface WeeklyStatsProps {
    currentDate: string;
}

export interface CountdownTimerProps {
    globalAlarmSource: string | null;
    stopGlobalAlarm: () => void;
}

// ---------------------------------------------------------------------------
// Page Props
// ---------------------------------------------------------------------------

export interface TrackerPageProps {
    date: string;
    /** Matches `DatePickerProps.setDate`: the provider's implementation is async. */
    setDate: (newDate: string) => void | Promise<void>;
    subjects: Subject[];
    setSubjects: DataValueSetter<Subject[]>;
}

export interface ReviewPageProps {
    checklistItems: ChecklistItem[];
    setChecklistItems: DataValueSetter<ChecklistItem[]>;
    qualityChecks: QualityCheckItem[];
    setQualityChecks: DataValueSetter<QualityCheckItem[]>;
    dayRating: string;
    setDayRating: (val: string) => void;
    errors: ErrorLogEntry[];
    setErrors: DataValueSetter<ErrorLogEntry[]>;
}

export interface StatsPageProps {
    subjects: Subject[];
    /**
     * The day the payload was loaded for, or `null` while a read is in flight.
     * The panels plot what has been adopted, so this is the only day the scope
     * sentence may name.
     */
    currentDate: string | null;
}

export interface TodoPageProps {
    todos: Todo[];
    setTodos: DataValueSetter<Todo[]>;
}

export interface FocusPageProps {
    globalAlarmSource: string | null;
    stopGlobalAlarm: () => void;
}

// ---------------------------------------------------------------------------
// Header Props
// ---------------------------------------------------------------------------

export interface HeaderProps {
    hasUnsavedChanges: boolean;
    isSaving: boolean;
    lastSaved: string | null;
    /** Async in practice; the header ignores the result and the handler reports failures. */
    onSave: () => void | Promise<void>;
    onDownloadPDF: () => void;
    onDownloadMD: () => void;
    onExport: () => void;
    onImportClick: () => void;
    onCheckForUpdates?: () => void;
    isCheckingUpdate?: boolean;
}

// ---------------------------------------------------------------------------
// Native Alarm Types
// ---------------------------------------------------------------------------

export interface NativeAlarmOptions {
    id: number;
    time: number;
    title?: string;
    body?: string;
}

/**
 * One entry of a `syncAlarms` batch. The web layer filters inactive alarms out before
 * building the list, and the native plugin treats a missing `enabled` key as armed, so a
 * definition that reaches the bridge is always an alarm to schedule.
 */
export type NativeAlarmDefinition = NativeAlarmOptions;

// ---------------------------------------------------------------------------
// Time Picker Internal Types
// ---------------------------------------------------------------------------

export interface TempTime {
    h: number;
    m: number;
    period: 'AM' | 'PM';
}

// ---------------------------------------------------------------------------
// Day Label Types
// ---------------------------------------------------------------------------

export interface DayLabel {
    readonly label: string;
    readonly value: number;
    readonly full: string;
}

// ---------------------------------------------------------------------------
// Bar Chart Types
// ---------------------------------------------------------------------------

export interface BarProps {
    actual: number;
    planned: number;
    label: string;
    isToday: boolean;
    maxHeight?: number;
}

export interface StatCardProps {
    icon: React.ComponentType<Record<string, unknown>>;
    label: string;
    value: string;
    subtext?: string;
    color?: string;
}

export interface PieSegmentProps {
    percentage: number;
    color: string;
    startAngle: number;
}

export interface SubjectProgressBarProps {
    name: string;
    planned: number;
    actual: number;
    color: string;
}
