import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import packageJson from '../../package.json';

const GITHUB_REPO = 'sumon317/DailyStudyTracker';
const CURRENT_VERSION = packageJson.version;
const CACHE_KEY = 'update_check_cache';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface UpdateResult {
    available: boolean;
    tag?: string;
    url?: string;
    notes?: string;
    checkedAt?: number;
}

interface CacheData {
    result: UpdateResult;
    timestamp: number;
}

const getCache = (): CacheData | null => {
    try {
        const stored = localStorage.getItem(CACHE_KEY);
        if (stored) {
            const data = JSON.parse(stored) as CacheData;
            if (Date.now() - data.timestamp < CACHE_DURATION_MS) {
                return data;
            }
        }
    } catch {
        // Ignore cache errors
    }
    return null;
};

const setCache = (result: UpdateResult): void => {
    try {
        const data: CacheData = {
            result,
            timestamp: Date.now(),
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
        // Ignore cache errors
    }
};

const isNewer = (v1: string, v2: string): boolean => {
    const p1 = v1.split('.').map(Number.parseFloat);
    const p2 = v2.split('.').map(Number.parseFloat);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const num1 = p1[i] ?? 0;
        const num2 = p2[i] ?? 0;
        if (num1 > num2) {
            return true;
        }
        if (num1 < num2) {
            return false;
        }
    }
    return false;
};

const fetchLatestRelease = async (attempt: number): Promise<UpdateResult> => {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });

    if (!response.ok) {
        if (response.status === 403 && attempt < MAX_RETRIES) {
            const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '1', 10);
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
            return fetchLatestRelease(attempt + 1);
        }
        return { available: false };
    }

    const data = (await response.json()) as {
        tag_name: string;
        html_url: string;
        body: string;
        assets: { name: string; browser_download_url: string }[];
    };
    const latestTag = data.tag_name.replace(/^v/, '');

    if (isNewer(latestTag, CURRENT_VERSION)) {
        const apkAsset = data.assets.find((asset) => asset.name.endsWith('.apk'));
        const downloadUrl = apkAsset ? apkAsset.browser_download_url : data.html_url;

        return {
            available: true,
            tag: data.tag_name,
            url: downloadUrl,
            notes: data.body,
        };
    }

    return { available: false };
};

export const checkForUpdate = async (force = false): Promise<UpdateResult> => {
    if (!Capacitor.isNativePlatform()) {
        return { available: false };
    }

    if (!force) {
        const cached = getCache();
        if (cached) {
            return cached.result;
        }
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await fetchLatestRelease(attempt);
            setCache(result);
            return result;
        } catch {
            if (attempt < MAX_RETRIES) {
                await new Promise((resolve) => {
                    setTimeout(resolve, RETRY_DELAY_MS * attempt);
                });
            }
        }
    }

    return { available: false };
};

export const downloadAndInstallUpdate = async (
    url: string,
    onProgress: (progress: number) => void,
): Promise<{ success: boolean; error?: string }> => {
    try {
        const fileName = 'update.apk';

        const response = await fetch(url);
        if (!response.ok) {
            return { success: false, error: 'Failed to download update' };
        }

        const contentLength = response.headers.get('content-length');
        const totalSize = contentLength ? Number.parseInt(contentLength, 10) : 0;

        const reader = response.body?.getReader();
        if (!reader) {
            return { success: false, error: 'Failed to read response' };
        }

        const chunks: Uint8Array[] = [];
        let downloadedSize = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            chunks.push(value);
            downloadedSize += value.length;

            if (totalSize > 0) {
                const progress = Math.round((downloadedSize / totalSize) * 100);
                onProgress(progress);
            }
        }

        const blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.android.package-archive' });
        const base64 = await blobToBase64(blob);

        await Filesystem.writeFile({
            path: fileName,
            data: base64,
            directory: Directory.Cache,
        });

        onProgress(100);

        const AppModule = await import('@capacitor/app');
        const fileUri = await Filesystem.getUri({
            path: fileName,
            directory: Directory.Cache,
        });

        if (fileUri.uri) {
            const appPlugin = AppModule.App as unknown as { openUrl: (opts: { url: string }) => Promise<void> };
            if (appPlugin.openUrl) {
                await appPlugin.openUrl({
                    url: fileUri.uri,
                });
            }
        }

        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { success: false, error: message };
    }
};

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            const parts = result.split(',');
            const base64 = parts[1] ?? '';
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export const clearUpdateCache = (): void => {
    localStorage.removeItem(CACHE_KEY);
};

export const getCurrentVersion = (): string => {
    return CURRENT_VERSION;
};
