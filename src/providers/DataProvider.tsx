import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
    downloadBackup,
    loadFromNativeStorage,
    loadGlobalTodos,
    loadRecurringSubjects,
    saveGlobalTodos,
    saveRecurringSubjects,
    saveToNativeStorage,
} from '../db';
import type {
    ChecklistItem,
    DataProviderValue,
    DataValueSetter,
    ErrorLogEntry,
    QualityCheckItem,
    RecurringSubject,
    Subject,
    Todo,
} from '../types';

let nextId = Date.now();
const generateId = () => ++nextId;

const DataContext = createContext<DataProviderValue | null>(null);

const getToday = () => new Date().toISOString().split('T')[0] ?? '';

const syncRecurringSubjects = async (subjects: Subject[], _date: string): Promise<RecurringSubject[]> => {
    const recurring = subjects.filter((s) => s.recurring);
    if (recurring.length > 0) {
        await saveRecurringSubjects(recurring as RecurringSubject[]);
    }
    const stored = await loadRecurringSubjects();
    return stored || [];
};

interface DataProviderProps {
    children: ReactNode;
}

export default function DataProvider({ children }: DataProviderProps) {
    const [date, setDateState] = useState(getToday());
    const [subjects, setSubjectsState] = useState<Subject[]>([
        { id: 1, name: 'New Subject', planned: '60', actual: '0', kpi: 'N', time: '', reminder: false },
    ]);
    const [checklistItems, setChecklistItemsState] = useState<ChecklistItem[]>([
        { id: 1, label: 'Add your first checklist item here...', checked: false },
    ]);
    const [qualityChecks, setQualityChecksState] = useState<QualityCheckItem[]>([
        { id: 1, label: 'Did you understand the core concepts?', checked: false },
    ]);
    const [dayRating, setDayRatingState] = useState('');
    const [errors, setErrorsState] = useState<ErrorLogEntry[]>([
        { id: 1, question: '', mistake: '', correctLogic: '' },
    ]);
    const [todos, setTodosState] = useState<Todo[]>([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<string | null>(null);

    const dateRef = useRef<string>(date);
    dateRef.current = date;

    const loadDataForDate = useCallback(async (targetDate: string) => {
        const data = await loadFromNativeStorage(targetDate);
        if (data) {
            setSubjectsState(data.subjects || []);
            setChecklistItemsState(data.checklistItems || []);
            setQualityChecksState(data.qualityChecks || []);
            setDayRatingState(data.dayRating || '');
            setErrorsState(data.errors || []);
        } else {
            setSubjectsState([]);
            setChecklistItemsState([]);
            setQualityChecksState([]);
            setDayRatingState('');
            setErrorsState([]);
        }
    }, []);

    useEffect(() => {
        const init = async () => {
            const storedTodos = await loadGlobalTodos();
            if (storedTodos) setTodosState(storedTodos);
            await loadDataForDate(dateRef.current);
        };
        init();
    }, [loadDataForDate]);

    useEffect(() => {
        const saveTodos = async () => {
            await saveGlobalTodos(todos);
        };
        saveTodos();
    }, [todos]);

    const saveData = useCallback(async () => {
        setIsSaving(true);
        try {
            const data = {
                subjects,
                checklistItems,
                qualityChecks,
                dayRating,
                errors,
            };
            await saveToNativeStorage(dateRef.current, data);
            await syncRecurringSubjects(subjects, dateRef.current);
            setHasUnsavedChanges(false);
            setLastSaved(new Date().toISOString());
        } finally {
            setIsSaving(false);
        }
    }, [subjects, checklistItems, qualityChecks, dayRating, errors]);

    useEffect(() => {
        if (!hasUnsavedChanges) return;
        const timer = setInterval(saveData, 10000);
        return () => clearInterval(timer);
    }, [hasUnsavedChanges, saveData]);

    const setDate = useCallback(
        async (newDate: string) => {
            if (hasUnsavedChanges) {
                await saveData();
            }
            setDateState(newDate);
            await loadDataForDate(newDate);
        },
        [hasUnsavedChanges, saveData, loadDataForDate],
    );

    const exportData = useCallback((): number => {
        const data = {
            subjects,
            checklistItems,
            qualityChecks,
            dayRating,
            errors,
            todos,
        };
        const count = Object.values(data).flat().length;
        downloadBackup();
        return count;
    }, [subjects, checklistItems, qualityChecks, dayRating, errors, todos]);

    const importData = useCallback(
        async (file: File) => {
            const text = await file.text();
            const parsed = JSON.parse(text) as Record<string, unknown>;
            if (!parsed) return;

            if (parsed.subjects) setSubjectsState(parsed.subjects as Subject[]);
            if (parsed.checklistItems) setChecklistItemsState(parsed.checklistItems as ChecklistItem[]);
            if (parsed.qualityChecks) setQualityChecksState(parsed.qualityChecks as QualityCheckItem[]);
            if (parsed.dayRating !== undefined) setDayRatingState(parsed.dayRating as string);
            if (parsed.errors) setErrorsState(parsed.errors as ErrorLogEntry[]);
            if (parsed.todos) setTodosState(parsed.todos as Todo[]);

            const subjectsData = (parsed.subjects as Subject[]) || subjects;
            const checklistData = (parsed.checklistItems as ChecklistItem[]) || checklistItems;
            const qualityData = (parsed.qualityChecks as QualityCheckItem[]) || qualityChecks;
            const dayRatingData = (parsed.dayRating as string) ?? dayRating;
            const errorsData = (parsed.errors as ErrorLogEntry[]) || errors;

            await saveToNativeStorage(dateRef.current, {
                subjects: subjectsData,
                checklistItems: checklistData,
                qualityChecks: qualityData,
                dayRating: dayRatingData,
                errors: errorsData,
            });
            setHasUnsavedChanges(false);
            setLastSaved(new Date().toISOString());
        },
        [subjects, checklistItems, qualityChecks, dayRating, errors],
    );

    const downloadPDF = useCallback(() => {
        import('../utils/pdfGenerator').then(({ generatePDF }) => {
            generatePDF({
                date: dateRef.current,
                subjects,
                checklistItems,
                qualityChecks,
                dayRating,
                errors,
                todos,
            });
        });
    }, [subjects, checklistItems, qualityChecks, dayRating, errors, todos]);

    const downloadMD = useCallback(() => {
        import('../utils/mdGenerator').then(({ generateMarkdown }) => {
            generateMarkdown({
                date: dateRef.current,
                subjects,
                checklistItems,
                qualityChecks,
                dayRating,
                errors,
                todos,
            });
        });
    }, [subjects, checklistItems, qualityChecks, dayRating, errors, todos]);

    const wrapSet =
        <T,>(setter: React.Dispatch<React.SetStateAction<T>>): DataValueSetter<T> =>
        (updater) => {
            setter(updater);
            setHasUnsavedChanges(true);
        };

    const value: DataProviderValue = {
        date,
        subjects,
        checklistItems,
        qualityChecks,
        dayRating,
        errors,
        todos,
        hasUnsavedChanges,
        isSaving,
        lastSaved,
        setDate,
        setSubjects: wrapSet(setSubjectsState),
        setChecklistItems: wrapSet(setChecklistItemsState),
        setQualityChecks: wrapSet(setQualityChecksState),
        setDayRating: (val: string) => {
            setDayRatingState(val);
            setHasUnsavedChanges(true);
        },
        setErrors: wrapSet(setErrorsState),
        setTodos: wrapSet(setTodosState),
        saveData,
        exportData,
        importData,
        downloadPDF,
        downloadMD,
        loadDataForDate,
        syncRecurringSubjects: (s: Subject[], d: string) => syncRecurringSubjects(s, d),
        generateId,
    };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataProviderValue {
    const ctx = useContext(DataContext);
    if (!ctx) throw new Error('useData must be used within a DataProvider');
    return ctx;
}
