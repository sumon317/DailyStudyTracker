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
    recurring?: boolean;
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

export interface RecurringSubject extends Subject {
    recurring: true;
    recurringDays: number[];
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

export interface UpdateResult {
    available: boolean;
    tag?: string;
    url?: string;
    notes?: string;
}

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
    date: string;
    subjects: Subject[];
    checklistItems: ChecklistItem[];
    qualityChecks: QualityCheckItem[];
    dayRating: string;
    errors: ErrorLogEntry[];
    todos: Todo[];
    hasUnsavedChanges: boolean;
    isSaving: boolean;
    lastSaved: string | null;
    setDate: (newDate: string) => Promise<void>;
    setSubjects: DataValueSetter<Subject[]>;
    setChecklistItems: DataValueSetter<ChecklistItem[]>;
    setQualityChecks: DataValueSetter<QualityCheckItem[]>;
    setDayRating: (val: string) => void;
    setErrors: DataValueSetter<ErrorLogEntry[]>;
    setTodos: DataValueSetter<Todo[]>;
    saveData: () => Promise<void>;
    exportData: () => number;
    importData: (file: File) => Promise<void>;
    downloadPDF: () => void;
    downloadMD: () => void;
    loadDataForDate: (targetDate: string) => Promise<void>;
    syncRecurringSubjects: (subjects: Subject[], date: string) => Promise<RecurringSubject[]>;
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
    setDate: (newDate: string) => void;
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

export interface InbuiltAlarmProps {
    globalAlarmSource: string | null;
    stopGlobalAlarm: () => void;
}

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
    updateInfo: UpdateResult | null;
    onClose: () => void;
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
    setDate: (newDate: string) => void;
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
    currentDate: string;
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
    onSave: () => void;
    onDownloadPDF: () => void;
    onDownloadMD: () => void;
    onExport: () => void;
    onImportClick: () => void;
}

// ---------------------------------------------------------------------------
// Native Alarm Types
// ---------------------------------------------------------------------------

export interface NativeAlarmOptions {
    id: number;
    time: number;
    title: string;
    body: string;
}

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
