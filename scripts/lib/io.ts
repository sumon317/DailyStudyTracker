import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Reads a text file. */
export const readText = async (path: string): Promise<string> => Bun.file(path).text();

/** Reads and parses a JSON file. */
export const readJson = async (path: string): Promise<unknown> => Bun.file(path).json();

/** Whether a path exists on disk. */
export const fileExists = (path: string): boolean => existsSync(path);

/** The size of a file in bytes, or `0` when it does not exist. */
export const fileSize = (path: string): number => (existsSync(path) ? statSync(path).size : 0);

/** Every file under a directory, recursively, in directory order. */
export const walkFiles = (directory: string): string[] => {
    const found: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const next = join(directory, entry.name);
        if (entry.isDirectory()) {
            found.push(...walkFiles(next));
        } else {
            found.push(next);
        }
    }
    return found;
};

/**
 * The pixel dimensions of a PNG, or `null` when the file is not a readable PNG.
 *
 * The dimensions are read out of the IHDR chunk rather than by decoding the image, so the check
 * costs a few bytes of I/O instead of a full decode.
 */
export const pngSize = (path: string): { width: number; height: number } | null => {
    const bytes = readFileSync(path);
    if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) {
        return null;
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

/**
 * The pixel dimensions of a JPEG, or null when the file is not a readable JPEG.
 * Reads the start-of-frame marker without fully decoding the image.
 */
export const jpegSize = (path: string): { width: number; height: number } | null => {
    const bytes = readFileSync(path);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        while (bytes[offset] === 0xff) offset += 1;
        const marker = bytes[offset++];
        if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > bytes.length) return null;
        const length = bytes.readUInt16BE(offset);
        if (length < 2 || offset + length > bytes.length) return null;
        if (frameMarkers.has(marker) && length >= 7) {
            return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
        }
        offset += length;
    }
    return null;
};

/**
 * Runs a check and turns a failure into a single readable line and a non-zero exit code.
 *
 * The scripts are gates: CI reads the exit code, and a person reading the log wants to know
 * *what* is wrong before they read a stack trace.
 */
export const runCheck = async (title: string, check: () => Promise<string>): Promise<void> => {
    try {
        const summary = await check();
        // biome-ignore lint/suspicious/noConsole: a gate's output is its interface.
        console.log(summary);
    } catch (error) {
        // biome-ignore lint/suspicious/noConsole: a gate's output is its interface.
        console.error(`${title} failed:\n${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
};
