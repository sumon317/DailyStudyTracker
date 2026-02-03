import { useState, useCallback } from 'react';

export const useFileSystem = () => {
    const [directoryHandle, setDirectoryHandle] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);
    const [error, setError] = useState(null);

    const connect = useCallback(async () => {
        setError(null);
        // We still keep the check to warn/prevent errors, but no fallback mode
        if (typeof window.showDirectoryPicker !== 'function') {
            const msg = 'File System Access API is not supported in this browser. Please use Chrome, Edge, or Opera.';
            setError(msg);
            alert(msg);
            return false;
        }

        try {
            const handle = await window.showDirectoryPicker();
            setDirectoryHandle(handle);
            return true;
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error connecting to folder:', error);
                setError(error.message);
                alert(`Failed to connect: ${error.message}`);
            }
            return false;
        }
    }, []);

    const getFileName = (date) => `${date}.json`;

    const saveDay = useCallback(async (date, data) => {
        if (!directoryHandle) return;

        try {
            setIsSaving(true);
            const fileName = getFileName(date);
            const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
            setLastSaved(new Date());
        } catch (error) {
            console.error('Error saving file:', error);
            setError('Failed to save file');
        } finally {
            setIsSaving(false);
        }
    }, [directoryHandle]);

    const loadDay = useCallback(async (date) => {
        if (!directoryHandle) return null;

        try {
            const fileName = getFileName(date);
            const fileHandle = await directoryHandle.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            const text = await file.text();
            return JSON.parse(text);
        } catch (error) {
            if (error.name === 'NotFoundError') {
                return null;
            }
            console.error('Error loading file:', error);
            return null;
        }
    }, [directoryHandle]);

    return {
        isConnected: !!directoryHandle,
        isSaving,
        lastSaved,
        error,
        connect,
        saveDay,
        loadDay
    };
};
