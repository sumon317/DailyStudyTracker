import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import Dexie from 'dexie';
import type { DayData, RecurringSubject, Todo } from './types';

interface DaysTable {
    date: string;
    updatedAt: string;
}

interface StudyTrackerDB extends Dexie {
    days: Dexie.Table<DaysTable, string>;
}

export const db = new Dexie('StudyTrackerDB') as StudyTrackerDB;

db.version(1).stores({
    days: 'date, updatedAt',
});

const isNative = Capacitor.isNativePlatform();

const STORAGE_FILE = 'study-tracker-data.json';
const RECURRING_KEY = '__recurring_subjects';
const TODOS_KEY = '__global_todos';

interface NativeStorageData {
    [key: string]: DayData | RecurringSubject[] | Todo[] | undefined;
}

export const saveRecurringSubjects = async (recurringSubjects: RecurringSubject[]): Promise<boolean> => {
    if (!isNative) {
        localStorage.setItem(RECURRING_KEY, JSON.stringify(recurringSubjects));
        return true;
    }

    try {
        let allData: NativeStorageData = {};
        try {
            const existingFile = await Filesystem.readFile({
                path: STORAGE_FILE,
                directory: Directory.Data,
                encoding: Encoding.UTF8,
            });
            allData = JSON.parse(existingFile.data as string);
        } catch {
            allData = {};
        }

        allData[RECURRING_KEY] = recurringSubjects;

        await Filesystem.writeFile({
            path: STORAGE_FILE,
            data: JSON.stringify(allData, null, 2),
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        return true;
    } catch {
        localStorage.setItem(RECURRING_KEY, JSON.stringify(recurringSubjects));
        return true;
    }
};

export const loadRecurringSubjects = async (): Promise<RecurringSubject[]> => {
    if (!isNative) {
        const stored = localStorage.getItem(RECURRING_KEY);
        return stored ? (JSON.parse(stored) as RecurringSubject[]) : [];
    }

    try {
        const existingFile = await Filesystem.readFile({
            path: STORAGE_FILE,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        const allData = JSON.parse(existingFile.data as string) as NativeStorageData;
        return (allData[RECURRING_KEY] as RecurringSubject[]) || [];
    } catch {
        const stored = localStorage.getItem(RECURRING_KEY);
        return stored ? (JSON.parse(stored) as RecurringSubject[]) : [];
    }
};

export const saveGlobalTodos = async (todos: Todo[]): Promise<boolean> => {
    if (!isNative) {
        localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
        return true;
    }

    try {
        let allData: NativeStorageData = {};
        try {
            const existingFile = await Filesystem.readFile({
                path: STORAGE_FILE,
                directory: Directory.Data,
                encoding: Encoding.UTF8,
            });
            allData = JSON.parse(existingFile.data as string);
        } catch {
            allData = {};
        }

        allData[TODOS_KEY] = todos;

        await Filesystem.writeFile({
            path: STORAGE_FILE,
            data: JSON.stringify(allData, null, 2),
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        return true;
    } catch {
        localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
        return true;
    }
};

export const loadGlobalTodos = async (): Promise<Todo[] | null> => {
    if (!isNative) {
        const stored = localStorage.getItem(TODOS_KEY);
        return stored ? (JSON.parse(stored) as Todo[]) : null;
    }

    try {
        const existingFile = await Filesystem.readFile({
            path: STORAGE_FILE,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        const allData = JSON.parse(existingFile.data as string) as NativeStorageData;
        return (allData[TODOS_KEY] as Todo[]) || null;
    } catch {
        const stored = localStorage.getItem(TODOS_KEY);
        return stored ? (JSON.parse(stored) as Todo[]) : null;
    }
};

export const saveToNativeStorage = async (date: string, data: Omit<DayData, 'date' | 'updatedAt'>): Promise<void> => {
    if (!isNative) {
        await db.days.put({ ...data, date, updatedAt: new Date().toISOString() });
        return;
    }

    try {
        let allData: NativeStorageData = {};
        try {
            const existingFile = await Filesystem.readFile({
                path: STORAGE_FILE,
                directory: Directory.Data,
                encoding: Encoding.UTF8,
            });
            allData = JSON.parse(existingFile.data as string);
        } catch {
            allData = {};
        }

        allData[date] = { ...data, date, updatedAt: new Date().toISOString() } as DayData;

        await Filesystem.writeFile({
            path: STORAGE_FILE,
            data: JSON.stringify(allData, null, 2),
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
    } catch {
        await db.days.put({ ...data, date, updatedAt: new Date().toISOString() });
    }
};

export const loadFromNativeStorage = async (date: string): Promise<DayData | null> => {
    if (!isNative) {
        return (await db.days.get(date)) as DayData | null;
    }

    try {
        const existingFile = await Filesystem.readFile({
            path: STORAGE_FILE,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        const allData = JSON.parse(existingFile.data as string) as NativeStorageData;
        return (allData[date] as DayData) || null;
    } catch {
        return (await db.days.get(date)) as DayData | null;
    }
};

export const exportAllData = async (): Promise<DayData[]> => {
    if (!isNative) {
        return (await db.days.toArray()) as DayData[];
    }

    try {
        const existingFile = await Filesystem.readFile({
            path: STORAGE_FILE,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        const allData = JSON.parse(existingFile.data as string) as NativeStorageData;
        return Object.entries(allData)
            .filter(([key]) => !key.startsWith('__'))
            .map(([, value]) => value as DayData);
    } catch {
        return [];
    }
};

export const importAllData = async (importedData: DayData[]): Promise<number> => {
    if (!Array.isArray(importedData)) {
        throw new Error('Invalid data format: expected an array');
    }

    if (!isNative) {
        for (const entry of importedData) {
            if (entry.date) {
                await db.days.put(entry);
            }
        }
        return importedData.length;
    }

    let allData: NativeStorageData = {};
    try {
        const existingFile = await Filesystem.readFile({
            path: STORAGE_FILE,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        allData = JSON.parse(existingFile.data as string);
    } catch {
        allData = {};
    }

    for (const entry of importedData) {
        if (entry.date) {
            allData[entry.date] = entry;
        }
    }

    await Filesystem.writeFile({
        path: STORAGE_FILE,
        data: JSON.stringify(allData, null, 2),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
    });
    return importedData.length;
};

export const downloadBackup = async (): Promise<number> => {
    const data = await exportAllData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `study-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return data.length;
};

export const handleFileImport = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target?.result as string) as DayData[];
                const count = await importAllData(data);
                resolve(count);
            } catch {
                reject(new Error('Invalid JSON file'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
};
