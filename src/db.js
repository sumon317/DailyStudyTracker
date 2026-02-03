import Dexie from 'dexie';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

export const db = new Dexie('StudyTrackerDB');

db.version(1).stores({
    days: 'date, updatedAt' // Primary key: date
});

// Check if running on native platform (Android/iOS)
const isNative = Capacitor.isNativePlatform();

// Native file storage helper for Android
const STORAGE_FILE = 'study-tracker-data.json';

/**
 * Save data to native file storage (Android)
 * Falls back to IndexedDB on web
 */
export const saveToNativeStorage = async (date, data) => {
    if (!isNative) {
        // Web: use IndexedDB via Dexie
        return db.days.put({ ...data, date, updatedAt: new Date().toISOString() });
    }

    try {
        // Read existing data
        let allData = {};
        try {
            const existingFile = await Filesystem.readFile({
                path: STORAGE_FILE,
                directory: Directory.Data,
                encoding: Encoding.UTF8,
            });
            allData = JSON.parse(existingFile.data);
        } catch (e) {
            // File doesn't exist yet, start fresh
            allData = {};
        }

        // Update with new data
        allData[date] = { ...data, date, updatedAt: new Date().toISOString() };

        // Write back to file
        await Filesystem.writeFile({
            path: STORAGE_FILE,
            data: JSON.stringify(allData, null, 2),
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });

        console.log('[Native Storage] Saved data for', date);
        return true;
    } catch (error) {
        console.error('[Native Storage] Save error:', error);
        // Fallback to IndexedDB
        return db.days.put({ ...data, date, updatedAt: new Date().toISOString() });
    }
};

/**
 * Load data from native file storage (Android)
 * Falls back to IndexedDB on web
 */
export const loadFromNativeStorage = async (date) => {
    if (!isNative) {
        // Web: use IndexedDB via Dexie
        return db.days.get(date);
    }

    try {
        const existingFile = await Filesystem.readFile({
            path: STORAGE_FILE,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        const allData = JSON.parse(existingFile.data);
        console.log('[Native Storage] Loaded data for', date);
        return allData[date] || null;
    } catch (error) {
        console.log('[Native Storage] No data found, checking IndexedDB fallback');
        // Fallback to IndexedDB (for migration from old data)
        return db.days.get(date);
    }
};

/**
 * Export all data as JSON (for backup)
 */
export const exportAllData = async () => {
    if (!isNative) {
        return db.days.toArray();
    }

    try {
        const existingFile = await Filesystem.readFile({
            path: STORAGE_FILE,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        const allData = JSON.parse(existingFile.data);
        return Object.values(allData);
    } catch (error) {
        return [];
    }
};

/**
 * Import data from JSON backup
 * Merges with existing data (newer entries win)
 */
export const importAllData = async (importedData) => {
    if (!Array.isArray(importedData)) {
        throw new Error('Invalid data format: expected an array');
    }

    if (!isNative) {
        // Web: import to IndexedDB
        for (const entry of importedData) {
            if (entry.date) {
                await db.days.put(entry);
            }
        }
        return importedData.length;
    }

    try {
        // Native: merge with existing file
        let allData = {};
        try {
            const existingFile = await Filesystem.readFile({
                path: STORAGE_FILE,
                directory: Directory.Data,
                encoding: Encoding.UTF8,
            });
            allData = JSON.parse(existingFile.data);
        } catch (e) {
            allData = {};
        }

        // Merge imported data
        for (const entry of importedData) {
            if (entry.date) {
                allData[entry.date] = entry;
            }
        }

        // Write back
        await Filesystem.writeFile({
            path: STORAGE_FILE,
            data: JSON.stringify(allData, null, 2),
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });

        console.log('[Native Storage] Imported', importedData.length, 'entries');
        return importedData.length;
    } catch (error) {
        console.error('[Native Storage] Import error:', error);
        throw error;
    }
};

/**
 * Download backup as JSON file (browser download)
 */
export const downloadBackup = async () => {
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

/**
 * Handle file import from input element
 */
export const handleFileImport = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const count = await importAllData(data);
                resolve(count);
            } catch (error) {
                reject(new Error('Invalid JSON file'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
};
