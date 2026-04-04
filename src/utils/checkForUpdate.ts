import { Capacitor } from '@capacitor/core';
import packageJson from '../../package.json';

const GITHUB_REPO = 'sumon317/DailyStudyTracker';
const CURRENT_VERSION = packageJson.version;

interface UpdateResult {
    available: boolean;
    tag?: string;
    url?: string;
    notes?: string;
}

export const checkForUpdate = async (): Promise<UpdateResult> => {
    if (!Capacitor.isNativePlatform()) {
        return { available: false };
    }

    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
        if (!response.ok) return { available: false };

        const data = (await response.json()) as {
            tag_name: string;
            html_url: string;
            body: string;
            assets: { name: string; browser_download_url: string }[];
        };
        const latestTag = data.tag_name.replace(/^v/, '');
        const currentVersion = CURRENT_VERSION;

        if (isNewer(latestTag, currentVersion)) {
            const apkAsset = data.assets.find((asset) => asset.name.endsWith('.apk'));
            const downloadUrl = apkAsset ? apkAsset.browser_download_url : data.html_url;

            return {
                available: true,
                tag: data.tag_name,
                url: downloadUrl,
                notes: data.body,
            };
        }
    } catch (_error) {
        // Silently ignore update check errors
    }
    return { available: false };
};

const isNewer = (v1: string, v2: string): boolean => {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const num1 = p1[i] ?? 0;
        const num2 = p2[i] ?? 0;
        if (num1 > num2) return true;
        if (num1 < num2) return false;
    }
    return false;
};
