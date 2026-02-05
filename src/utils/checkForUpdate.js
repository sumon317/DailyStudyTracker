import { Capacitor } from '@capacitor/core';
import packageJson from '../../package.json';

const GITHUB_REPO = 'sumon317/DailyStudyTracker';
const CURRENT_VERSION = packageJson.version;

/**
 * @typedef {Object} UpdateResult
 * @property {boolean} available - Whether an update is available
 * @property {string} [tag] - The new version tag (e.g. "v1.0.3")
 * @property {string} [url] - Download URL for the APK
 * @property {string} [notes] - Release notes/body
 */

/**
 * Checks if a newer version is available on GitHub Releases.
 * @returns {Promise<UpdateResult>}
 */
export const checkForUpdate = async () => {
    // Only run on native Android to avoid annoying web users (or run on both if desired)
    // For now, let's allow it everywhere but the download link will differ

    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
        if (!response.ok) return { available: false };

        const data = await response.json();
        const latestTag = data.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
        const currentVersion = CURRENT_VERSION;

        if (isNewer(latestTag, currentVersion)) {
            // Find the APK asset
            const apkAsset = data.assets.find(asset => asset.name.endsWith('.apk'));
            const downloadUrl = apkAsset ? apkAsset.browser_download_url : data.html_url;

            return {
                available: true,
                tag: data.tag_name,
                url: downloadUrl,
                notes: data.body
            };
        }
    } catch (error) {
        console.error('Update check failed:', error);
    }
    return { available: false };
};

// Simple semver comparison: returns true if v1 > v2
const isNewer = (v1, v2) => {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const num1 = p1[i] || 0;
        const num2 = p2[i] || 0;
        if (num1 > num2) return true;
        if (num1 < num2) return false;
    }
    return false;
};
