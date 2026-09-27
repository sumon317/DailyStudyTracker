import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import packageJson from '../../package.json';
// The plugin default is imported statically alongside the three predicates it exports. It used to
// be pulled in with a second, dynamic `import()` at the install step, on the theory that the
// bridge would then only be registered once a user actually reached it. That theory never held:
// the predicates above are imported statically, so the module - and therefore the `registerPlugin`
// call at its top level - was already in the graph the moment this service was. The dynamic import
// could not defer anything, it only added a promise and a duplicate specifier, and the bundler
// reported it as an ineffective dynamic import. The static import is the honest form.
import NativeAppUpdate, {
    INSTALL_PERMISSION_ERROR,
    isAndroidInstallTarget,
    isInstallPermissionGranted,
} from '../native/NativeAppUpdate';
import type { UpdateResult } from '../types';

const GITHUB_OWNER = 'sumon317';
const GITHUB_REPO_NAME = 'DailyStudyTracker';
const GITHUB_REPO = `${GITHUB_OWNER}/${GITHUB_REPO_NAME}`;
const CURRENT_VERSION = packageJson.version;

const CACHE_SCHEMA_VERSION = 2;
const CACHE_KEY = `update_check_cache:v${CACHE_SCHEMA_VERSION}`;
const LEGACY_CACHE_KEYS = ['update_check_cache'];
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
/**
 * Unauthenticated GitHub API calls are rate limited per IP. When a check fails *because* of the
 * limit, a previously verified answer is far more useful than an error dialog, so a stale entry
 * inside this window is served instead — bounded, so an abandoned entry cannot be replayed
 * forever. Digests are always re-verified against the downloaded bytes before anything installs.
 */
const MAX_STALE_ANSWER_MS = 7 * 24 * 60 * 60 * 1000;
/** Tolerance for a device clock that is slightly ahead of the one that wrote the entry. */
const MAX_CACHE_FUTURE_SKEW_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 30_000;
const CACHE_FILE_NAME = 'update.apk';

export const MAX_UPDATE_SIZE_BYTES = 100 * 1024 * 1024;
/** Maximum time the download may stall (no bytes received) before it is aborted. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;
/** Maximum time the verified APK may spend being handed to the platform installer. */
export const INSTALL_TIMEOUT_MS = 60_000;

/**
 * How many base64 characters cross the bridge in a single filesystem call.
 *
 * The APK has to reach the native side as base64, which is the whole memory problem: a 100 MB
 * asset is 133 MB of characters, and a single `writeFile` of that size materialises the string
 * once here, once again when the Capacitor bridge serialises the options object to JSON, and a
 * third time as the Java `String` the plugin finally decodes. On the low-memory devices this
 * app targets that is a certain OOM long before the transfer is even finished.
 *
 * The payload is therefore appended in bounded chunks instead. The value is a multiple of four so
 * every chunk boundary lands on a whole base64 group and no `=` padding can ever appear in the
 * middle of the file - a padded chunk followed by more data is not valid base64 and the plugin
 * would refuse the whole file.
 */
const BASE64_WRITE_CHUNK_CHARS = 256 * 1024;

const MAX_RELEASE_METADATA_BYTES = 512 * 1024;
const MAX_RELEASE_TAG_LENGTH = 64;
const MAX_RELEASE_NOTES_LENGTH = 20_000;
const MAX_RELEASE_ASSETS = 200;
const MAX_ASSET_NAME_LENGTH = 64;
const MAX_EMPTY_STREAM_READS = 64;
const APK_ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

const API_HOST = 'api.github.com';
const API_PATH = `/repos/${GITHUB_REPO}/releases/latest`;
const RELEASE_HOST_PREFIXES: ReadonlyArray<{ host: string; pathPrefix: string }> = [
    { host: 'github.com', pathPrefix: `/${GITHUB_REPO}/releases/` },
    { host: 'release-assets.githubusercontent.com', pathPrefix: '/github-production-release-asset/' },
];

const NOT_APK_ERROR = 'Only APK updates can be installed automatically.';
const DIGEST_REQUIRED_ERROR =
    'A GitHub SHA-256 digest is required for automatic installation. Use manual browser installation instead.';
const TOO_LARGE_ERROR = 'The update exceeds the safe download size limit.';
const SIZE_MISMATCH_ERROR = 'The update size does not match GitHub metadata.';
const HASH_MISMATCH_ERROR = 'The update SHA-256 verification failed.';
const UNREADABLE_RESPONSE_ERROR = 'The update response cannot be read safely.';
const EMPTY_RESPONSE_ERROR = 'The update response was empty.';
const NOT_AN_APK_ERROR = 'The update response was not an APK.';
const GENERIC_FAILURE_ERROR = 'The update could not be completed.';
const TIMEOUT_ERROR = 'The update timed out. Check your connection and try again.';
const INTERRUPTED_ERROR = 'The update was interrupted before it finished downloading.';
const NOT_ANDROID_ERROR = 'Automatic updates are only available in the Android app.';
/**
 * Internal marker: the transfer outlived the deadline that stopped waiting for it, so it must not
 * touch the filesystem or the installer any more. Never surfaced - the outer catch reports the
 * timeout instead.
 */
const ABANDONED_ERROR = 'The update transfer was abandoned after it timed out.';

export type UpdateUrlKind = 'api' | 'release';

export interface UpdateInstallResult {
    success: boolean;
    error?: string;
    assetName?: string;
    sha256?: string;
    size?: number;
}

export interface UpdateDownloadOptions {
    onProgress?: (progress: number) => void;
    onPhase?: (phase: 'downloading' | 'installing' | 'success') => void;
    expectedSha256?: string;
    expectedSize?: number;
    assetName?: string;
}

export type UpdateDownloadSource = string | UpdateResult;

interface CacheData {
    schema: number;
    version: string;
    result: UpdateResult;
    timestamp: number;
}

interface GithubAsset {
    name: string;
    browser_download_url: string;
    size?: number;
    digest?: string;
    sha256?: string;
}

interface ParsedVersion {
    core: [string, string, string];
    prerelease: string[];
}

class UpdateCheckError extends Error {
    readonly retryable: boolean;
    readonly retryAfterMs: number;
    /** True when the failure is the API quota rather than a broken endpoint. */
    readonly rateLimited: boolean;

    constructor(message: string, retryable: boolean, retryAfterMs = 0, rateLimited = false) {
        super(message);
        this.name = 'UpdateCheckError';
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
        this.rateLimited = rateLimited;
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** `isRecord`, but an array is not a usable result object. */
const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isAbortError = (error: unknown): boolean =>
    isRecord(error) && typeof error.name === 'string' && error.name === 'AbortError';

const cappedText = (value: unknown, limit: number): string | undefined =>
    typeof value === 'string' && value.length > 0 && value.length <= limit ? value : undefined;

/**
 * Path shapes that `new URL()` silently *repairs* instead of rejecting: it converts `\` to `/`
 * in special schemes and resolves `%2e`/`%2e%2e` as dot segments. Deciding the allowlist from
 * the parser's output would therefore accept `..\..\attacker` and `%2e%2e` inputs, so the raw
 * path is screened before parsing. Percent-encoding that this project never publishes (encoded
 * dots, encoded backslashes) is refused outright; `%20` and friends stay legal because the
 * decoded-path traversal check below already handles them.
 */
const REPAIRED_PATH_PATTERN = /\\|%2e|%5c/i;

/**
 * Control characters and raw spaces. `new URL()` silently deletes ASCII tabs and newlines from a
 * URL, so a value carrying one would be validated in a different shape than the one requested —
 * the classic parser-differential setup for request splitting. GitHub percent-encodes spaces, so a
 * published `browser_download_url` never needs either.
 */
const hasForbiddenCharacter = (value: string): boolean => {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x20 || code === 0x7f) {
            return true;
        }
    }
    return false;
};

/** Returns the path exactly as it was written, before any URL normalisation. */
const rawPathOf = (value: string): string => {
    const schemeEnd = value.indexOf('://');
    const afterScheme = schemeEnd === -1 ? value : value.slice(schemeEnd + 3);
    const authorityStart = afterScheme.search(/[/?#]/);
    if (authorityStart === -1) {
        return '';
    }
    const fromPath = afterScheme.slice(authorityStart);
    const queryStart = fromPath.search(/[?#]/);
    return queryStart === -1 ? fromPath : fromPath.slice(0, queryStart);
};

export const isAllowedUpdateUrl = (value: string, kind: UpdateUrlKind = 'release'): boolean => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
        return false;
    }
    if (hasForbiddenCharacter(value) || REPAIRED_PATH_PATTERN.test(rawPathOf(value))) {
        return false;
    }
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (
        url.protocol !== 'https:' ||
        url.username !== '' ||
        url.password !== '' ||
        url.hash !== '' ||
        (url.port !== '' && url.port !== '443')
    ) {
        return false;
    }
    const host = url.hostname.toLowerCase();
    if (host.includes('%')) {
        return false;
    }
    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(url.pathname);
    } catch {
        return false;
    }
    if (decodedPath.includes('\\') || decodedPath.split('/').includes('..')) {
        return false;
    }
    if (kind === 'api') {
        return host === API_HOST && url.pathname === API_PATH;
    }
    return RELEASE_HOST_PREFIXES.some((rule) => host === rule.host && url.pathname.startsWith(rule.pathPrefix));
};

export const isAllowedGithubApiUrl = (value: string): boolean => isAllowedUpdateUrl(value, 'api');
export const isAllowedReleaseUrl = (value: string): boolean => isAllowedUpdateUrl(value, 'release');

const APK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,62}\.apk$/i;

const isApkName = (value: unknown): value is string =>
    typeof value === 'string' && value.length <= MAX_ASSET_NAME_LENGTH && APK_NAME_PATTERN.test(value);

const assetNameFromUrl = (value: string): string | null => {
    try {
        const path = decodeURIComponent(new URL(value).pathname);
        const name = path.substring(path.lastIndexOf('/') + 1);
        return isApkName(name) ? name : null;
    } catch {
        return null;
    }
};

const normalizeDigest = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const match = /^(?:sha256:)?([0-9a-f]{64})$/i.exec(value.trim());
    return match?.[1]?.toLowerCase();
};

const validSize = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isNumericIdentifier = (value: string): boolean => /^\d+$/.test(value);

const compareNumericIdentifier = (left: string, right: string): number => {
    if (left.length !== right.length) {
        return left.length - right.length;
    }
    return left === right ? 0 : left > right ? 1 : -1;
};

const parseVersion = (value: string): ParsedVersion | null => {
    const match =
        /^v?(\d+)\.(\d+)\.(\d+)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
            value.trim(),
        );
    if (!match) {
        return null;
    }
    const core: [string, string, string] = [match[1] ?? '', match[2] ?? '', match[3] ?? ''];
    if (core.some((part) => part.length > 1 && part.startsWith('0'))) {
        return null;
    }
    return { core, prerelease: match[4] ? match[4].split('.') : [] };
};

/** Semver 11.4 precedence: numeric identifiers below alphanumeric ones, ASCII order within each class. */
const comparePrerelease = (left: string[], right: string[]): number => {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftId = left[index];
        const rightId = right[index];
        if (leftId === undefined) {
            return -1;
        }
        if (rightId === undefined) {
            return 1;
        }
        const leftNumeric = isNumericIdentifier(leftId);
        const rightNumeric = isNumericIdentifier(rightId);
        if (leftNumeric && rightNumeric) {
            const difference = compareNumericIdentifier(leftId, rightId);
            if (difference !== 0) {
                return difference;
            }
            continue;
        }
        if (leftNumeric !== rightNumeric) {
            return leftNumeric ? -1 : 1;
        }
        if (leftId !== rightId) {
            return leftId > rightId ? 1 : -1;
        }
    }
    return 0;
};

const compareVersions = (left: ParsedVersion, right: ParsedVersion): number => {
    for (let index = 0; index < 3; index += 1) {
        const leftPart = left.core[index] ?? '0';
        const rightPart = right.core[index] ?? '0';
        const difference = compareNumericIdentifier(leftPart, rightPart);
        if (difference !== 0) {
            return difference;
        }
    }
    if (left.prerelease.length === 0 && right.prerelease.length === 0) {
        return 0;
    }
    if (left.prerelease.length === 0) {
        return 1;
    }
    if (right.prerelease.length === 0) {
        return -1;
    }
    return comparePrerelease(left.prerelease, right.prerelease);
};

const isCacheableResult = (value: unknown): value is UpdateResult => {
    if (!isRecord(value) || typeof value.available !== 'boolean') {
        return false;
    }
    if (cappedText(value.tag, MAX_RELEASE_TAG_LENGTH) === undefined && value.tag !== undefined) {
        return false;
    }
    if (cappedText(value.notes, MAX_RELEASE_NOTES_LENGTH) === undefined && value.notes !== undefined) {
        return false;
    }
    if (value.url !== undefined && (typeof value.url !== 'string' || !isAllowedReleaseUrl(value.url))) {
        return false;
    }
    if (value.assetName !== undefined && !isApkName(value.assetName)) {
        return false;
    }
    if (value.sha256 !== undefined && normalizeDigest(value.sha256) === undefined) {
        return false;
    }
    if (value.size !== undefined && !validSize(value.size)) {
        return false;
    }
    // Coherence: an "available" answer with no approved URL can be neither downloaded nor opened,
    // so caching one only produces a modal that offers no way to update. Conversely a "no update"
    // answer has no business carrying install metadata into the UI.
    if (value.available && (typeof value.url !== 'string' || !isAllowedReleaseUrl(value.url))) {
        return false;
    }
    if (!value.available && (value.url !== undefined || value.assetName !== undefined)) {
        return false;
    }
    return true;
};

/**
 * Reads a cached answer that is at most `maxAgeMs` old. A timestamp further in the future than
 * the tolerated skew is refused, so a forged or badly skewed clock cannot make an entry immortal.
 */
const getCache = (maxAgeMs: number = CACHE_DURATION_MS): UpdateResult | null => {
    try {
        if (typeof localStorage === 'undefined') {
            return null;
        }
        const stored = localStorage.getItem(CACHE_KEY);
        if (!stored) {
            return null;
        }
        const data: unknown = JSON.parse(stored);
        if (
            !isRecord(data) ||
            data.schema !== CACHE_SCHEMA_VERSION ||
            data.version !== CURRENT_VERSION ||
            typeof data.timestamp !== 'number' ||
            !Number.isFinite(data.timestamp) ||
            data.timestamp > Date.now() + MAX_CACHE_FUTURE_SKEW_MS ||
            Date.now() - data.timestamp >= maxAgeMs ||
            !isCacheableResult(data.result)
        ) {
            return null;
        }
        return data.result;
    } catch {
        return null;
    }
};

/**
 * Records a freshly fetched answer, replacing whatever was there.
 *
 * An answer that cannot be cached clears the entry instead of leaving it alone. The feed has just
 * spoken, and the previous entry - still inside its 24 hour window - describes an older state of
 * the world: keeping it would let the next unforced check report a release that the feed has
 * already superseded, and the user would be offered a download the app itself has just declined to
 * describe. The reachable shape is a release whose APK asset fails the allowlist and whose
 * `html_url` is not a release page, which leaves `available: true` with no URL to install from.
 */
const setCache = (result: UpdateResult): void => {
    try {
        if (typeof localStorage === 'undefined') {
            return;
        }
        if (!isCacheableResult(result)) {
            for (const key of [CACHE_KEY, ...LEGACY_CACHE_KEYS]) {
                localStorage.removeItem(key);
            }
            return;
        }
        const data: CacheData = {
            schema: CACHE_SCHEMA_VERSION,
            version: CURRENT_VERSION,
            result,
            timestamp: Date.now(),
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
        return;
    }
};

const wait = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });

/** Bounds a bridge call that cannot be cancelled through the fetch AbortSignal. */
const withDeadline = <T>(operation: Promise<T>, milliseconds: number, onTimeout: () => void): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            onTimeout();
            reject(new Error(TIMEOUT_ERROR));
        }, milliseconds);
        operation.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });

/**
 * Returns the server-requested delay in milliseconds, or `null` when the header carries no
 * usable instruction so the caller can fall back to its own backoff. Both the integer-seconds
 * and the HTTP-date form of `Retry-After` are honoured, and the result is always capped so a
 * hostile or confused header cannot park the app for hours.
 */
const getRetryDelay = (response: Response): number | null => {
    const header = response.headers?.get('retry-after')?.trim();
    if (!header) {
        return null;
    }
    if (/^\d+$/.test(header)) {
        const seconds = Number.parseInt(header, 10);
        return Number.isSafeInteger(seconds) ? Math.min(seconds * 1000, MAX_RETRY_DELAY_MS) : null;
    }
    const when = Date.parse(header);
    if (!Number.isFinite(when)) {
        return null;
    }
    return Math.min(Math.max(when - Date.now(), 0), MAX_RETRY_DELAY_MS);
};

const backoffDelay = (attempt: number): number => Math.min(RETRY_DELAY_MS * attempt, MAX_RETRY_DELAY_MS);

const fetchWithTimeout = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
    const requestInit: RequestInit = init.signal
        ? init
        : { ...init, ...(controller ? { signal: controller.signal } : {}) };
    try {
        const request = fetch(url, requestInit);
        if (controller) {
            return await request;
        }
        // Without an AbortController there is no way to cancel the socket, so the caller is
        // released on time even though the request itself keeps running.
        return await withDeadline(request, REQUEST_TIMEOUT_MS, () => undefined);
    } finally {
        clearTimeout(timeoutId);
    }
};

/** Releases an untouched response body so an abandoned request does not pin a connection. */
const discardBody = (response: Response): void => {
    try {
        const body = response.body as ReadableStream<Uint8Array> | null | undefined;
        if (body && typeof body.cancel === 'function') {
            void Promise.resolve(body.cancel()).catch(() => undefined);
        }
    } catch {
        return;
    }
};

const cancelReader = (reader: ReadableStreamDefaultReader<Uint8Array>): void => {
    try {
        void Promise.resolve(reader.cancel()).catch(() => undefined);
    } catch {
        return;
    }
};

/**
 * Reads at most `limit` *bytes* of metadata. A declared `content-length` short-circuits, and the
 * body is still walked chunk by chunk so a server that omits or understates the header cannot
 * force an unbounded allocation; previously the whole body was buffered first and only measured
 * afterwards. The cap is counted in bytes rather than UTF-16 units so multi-byte characters
 * cannot slip past it.
 */
const readCappedText = async (response: Response, limit = MAX_RELEASE_METADATA_BYTES): Promise<string | null> => {
    const declared = response.headers?.get('content-length')?.trim();
    if (declared && /^\d+$/.test(declared)) {
        const declaredBytes = Number.parseInt(declared, 10);
        if (Number.isSafeInteger(declaredBytes) && declaredBytes > limit) {
            discardBody(response);
            return null;
        }
    }
    const body = response.body as ReadableStream<Uint8Array> | null | undefined;
    if (!body || typeof body.getReader !== 'function') {
        // Non-streaming shims (older bridges, hand-rolled Response objects) can only be read
        // whole. The cheap unit check runs first so a huge body is not encoded just to measure it.
        const text = await response.text();
        if (text.length > limit) {
            return null;
        }
        return new TextEncoder().encode(text).length > limit ? null : text;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let received = 0;
    let text = '';
    let drained = false;
    try {
        while (true) {
            const result = await reader.read();
            if (result.done) {
                drained = true;
                break;
            }
            const value = result.value;
            if (!value || value.length === 0) {
                continue;
            }
            received += value.length;
            if (received > limit) {
                return null;
            }
            text += decoder.decode(value, { stream: true });
        }
        return text + decoder.decode();
    } finally {
        if (drained) {
            try {
                reader.releaseLock();
            } catch {
                // A reader that is already released needs no cleanup.
            }
        } else {
            cancelReader(reader);
        }
    }
};

interface ParsedRelease {
    tag: string;
    notes?: string;
    htmlUrl?: string;
    assets: GithubAsset[];
}

const parseReleaseResponse = (value: unknown): ParsedRelease | null => {
    if (!isRecord(value) || typeof value.tag_name !== 'string' || value.tag_name.length === 0) {
        return null;
    }
    if (value.tag_name.length > MAX_RELEASE_TAG_LENGTH) {
        return null;
    }
    const assets = Array.isArray(value.assets) ? value.assets.slice(0, MAX_RELEASE_ASSETS) : [];
    return {
        tag: value.tag_name,
        notes: typeof value.body === 'string' ? value.body.slice(0, MAX_RELEASE_NOTES_LENGTH) : undefined,
        htmlUrl: typeof value.html_url === 'string' ? value.html_url : undefined,
        assets: assets.filter(isRecord).map((asset) => ({
            name: typeof asset.name === 'string' ? asset.name : '',
            browser_download_url: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
            size: validSize(asset.size) ? asset.size : undefined,
            digest: typeof asset.digest === 'string' ? asset.digest : undefined,
            sha256: typeof asset.sha256 === 'string' ? asset.sha256 : undefined,
        })),
    };
};

/**
 * Ranks published APKs deterministically so a release cannot change which asset is installed by
 * reordering. `versions` holds the tag spellings this project publishes (`9.0.0` and `v9.0.0`,
 * plus any prerelease suffix) so a release-candidate asset still outranks a bare decoy.
 */
const apkAssetScore = (name: string, versions: ReadonlyArray<string>): number => {
    let score = 0;
    if (versions.some((version) => version.length > 0 && name.includes(`-${version}.apk`))) {
        score += 4;
    }
    if (name.toLowerCase().startsWith(GITHUB_REPO_NAME.toLowerCase())) {
        score += 2;
    }
    return score;
};

const selectApkAsset = (assets: GithubAsset[], versions: ReadonlyArray<string>): GithubAsset | undefined => {
    const candidates = assets.filter(
        (asset) =>
            isApkName(asset.name) &&
            isAllowedReleaseUrl(asset.browser_download_url) &&
            assetNameFromUrl(asset.browser_download_url) === asset.name,
    );
    if (candidates.length === 0) {
        return undefined;
    }
    const sorted = [...candidates].sort((left, right) => {
        const byScore = apkAssetScore(right.name, versions) - apkAssetScore(left.name, versions);
        if (byScore !== 0) {
            return byScore;
        }
        if (left.name.length !== right.name.length) {
            return left.name.length - right.name.length;
        }
        return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
    return sorted[0];
};

const fetchLatestRelease = async (): Promise<UpdateResult> => {
    const apiUrl = `https://${API_HOST}${API_PATH}`;
    if (!isAllowedGithubApiUrl(apiUrl)) {
        throw new UpdateCheckError('The update feed URL is not approved.', false);
    }
    const response = await fetchWithTimeout(apiUrl, {
        headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
    });
    if (response.url && !isAllowedGithubApiUrl(response.url)) {
        discardBody(response);
        throw new UpdateCheckError('The update feed returned an unapproved host.', false);
    }
    if (!response.ok) {
        discardBody(response);
        if (response.status === 404) {
            return { available: false };
        }
        if (response.status === 403 || response.status === 429) {
            throw new UpdateCheckError(
                'The update check was rate limited. Try again later.',
                false,
                getRetryDelay(response) ?? 0,
                true,
            );
        }
        // A 403 without a quota is indistinguishable from one with it for an unauthenticated
        // client, so both are treated as the limit; retrying a 403 only burns more of it.
        throw new UpdateCheckError(
            `Update service returned HTTP ${response.status}`,
            response.status >= 500,
            getRetryDelay(response) ?? 0,
        );
    }
    const text = await readCappedText(response);
    if (text === null) {
        throw new UpdateCheckError('The update feed returned an unreadable response.', false);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new UpdateCheckError('The update feed returned malformed metadata.', false);
    }
    const release = parseReleaseResponse(parsed);
    if (!release) {
        throw new UpdateCheckError('The update feed returned malformed metadata.', false);
    }
    const latestVersion = parseVersion(release.tag);
    if (!latestVersion) {
        throw new UpdateCheckError('The update feed returned an unreadable version tag.', false);
    }
    const currentVersion = parseVersion(CURRENT_VERSION);
    if (!currentVersion) {
        throw new UpdateCheckError('The installed version is not a readable semantic version.', false);
    }
    if (compareVersions(latestVersion, currentVersion) <= 0) {
        return { available: false };
    }
    // Semver ranks `1.3.0-rc.1` above `1.2.2`, but promoting a release candidate to every user
    // is a publishing mistake, not an update. A prerelease is only ever offered to another
    // prerelease, so release candidates stay testable without reaching stable installs.
    if (latestVersion.prerelease.length > 0 && currentVersion.prerelease.length === 0) {
        return { available: false };
    }

    const core = `${latestVersion.core[0]}.${latestVersion.core[1]}.${latestVersion.core[2]}`;
    const tagBody = release.tag.trim().replace(/^v/i, '');
    // The tag has already been validated as a bounded semantic version, so these spellings are
    // plain alphanumerics and can be matched against an asset name.
    const versions = [...new Set([`v${tagBody}`, tagBody, core])];
    const apkAsset = selectApkAsset(release.assets, versions);
    const releasePage = release.htmlUrl && isAllowedReleaseUrl(release.htmlUrl) ? release.htmlUrl : undefined;
    return {
        available: true,
        tag: release.tag,
        url: apkAsset?.browser_download_url ?? releasePage,
        notes: release.notes,
        assetName: apkAsset?.name,
        sha256: normalizeDigest(apkAsset?.digest) ?? normalizeDigest(apkAsset?.sha256),
        size: apkAsset?.size,
    };
};

export const checkForUpdate = async (force = false): Promise<UpdateResult> => {
    if (!Capacitor.isNativePlatform()) {
        return { available: false };
    }
    if (!force) {
        const cached = getCache();
        if (cached) {
            return cached;
        }
    }
    let lastError: UpdateCheckError | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            const result = await fetchLatestRelease();
            setCache(result);
            return result;
        } catch (error: unknown) {
            if (error instanceof UpdateCheckError) {
                if (!error.retryable) {
                    // A rate-limited check must not become a dead end: a previously verified
                    // answer beats an error dialog. `force` still surfaces the failure, because a
                    // user who explicitly asked to re-check wants the truth, not a week-old echo.
                    if (error.rateLimited && !force) {
                        const stale = getCache(MAX_STALE_ANSWER_MS);
                        if (stale) {
                            return stale;
                        }
                    }
                    throw error;
                }
                lastError = error;
            } else if (isAbortError(error)) {
                throw new Error('The update check timed out. Try again later.');
            } else {
                lastError = new UpdateCheckError('Unable to reach the update service.', true);
            }
            if (attempt < MAX_RETRIES) {
                await wait(lastError.retryAfterMs || backoffDelay(attempt));
            }
        }
    }
    throw new Error(`Unable to check for updates: ${lastError?.message ?? 'unknown error'}.`);
};

/**
 * Reads an optional string field. `undefined` means "not supplied" — JSON has no `undefined`, so
 * that is how a caller spells "GitHub did not report this" and it must not be treated as a
 * malformed value. Anything else of the wrong type becomes `''`, which the validation below
 * refuses, because dropping it silently would drop the constraint it carried.
 */
const readField = (source: Record<string, unknown>, key: string): string | undefined => {
    const value = source[key];
    if (value === undefined) {
        return undefined;
    }
    return typeof value === 'string' ? value : '';
};

/** Same rule for the numeric size field, whose unusable sentinel makes `validSize` refuse it. */
const readSize = (source: Record<string, unknown>): number | undefined => {
    const value = source.size;
    if (value === undefined) {
        return undefined;
    }
    return typeof value === 'number' ? value : Number.NaN;
};

const sourceFrom = (
    source: UpdateDownloadSource,
): {
    url?: string;
    assetName?: string;
    sha256?: string;
    size?: number;
} => {
    if (typeof source === 'string') {
        return { url: source, assetName: assetNameFromUrl(source) ?? undefined };
    }
    // A caller can hand over anything at all (`null` from a failed lookup, a number from a
    // deserialised payload). Reading `.url` off it would raise a raw TypeError that the UI shows
    // verbatim, so anything that is not a plain result object is treated as "no source" and
    // refused by the normal validation below.
    if (!isPlainRecord(source)) {
        return {};
    }
    // A field that is supplied but of the wrong type is a malformed result, not an absent one, and
    // is handed on as an unusable sentinel so the validation below refuses it rather than quietly
    // dropping the constraint it carried.
    return {
        url: readField(source, 'url'),
        assetName: readField(source, 'assetName'),
        sha256: readField(source, 'sha256'),
        size: readSize(source),
    };
};

type DownloadPhase = 'downloading' | 'installing' | 'success';

const normalizeDownloadArguments = (
    second?: ((progress: number) => void) | UpdateDownloadOptions,
    third?: ((phase: DownloadPhase) => void) | string,
    fourth?: number,
    fifth?: string,
): UpdateDownloadOptions => {
    if (typeof second === 'function') {
        if (typeof third === 'string') {
            return {
                onProgress: second,
                expectedSha256: third,
                expectedSize: fourth,
                assetName: fifth,
            };
        }
        return {
            onProgress: second,
            onPhase: typeof third === 'function' ? third : undefined,
            expectedSize: fourth,
            assetName: fifth,
        };
    }
    return second && isRecord(second) ? (second as UpdateDownloadOptions) : {};
};

interface Sha256Hasher {
    update: (bytes: Uint8Array) => void;
    hex: () => string;
}

const createSha256 = (): Sha256Hasher => {
    const constants = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
        0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
        0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
        0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    const rotateRight = (value: number, amount: number): number => (value >>> amount) | (value << (32 - amount));
    const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const words = new Uint32Array(64);
    const block = new Uint8Array(64);
    let blockLength = 0;
    let totalLength = 0;
    let finalized = false;

    const compress = (source: Uint8Array, offset: number): void => {
        for (let index = 0; index < 16; index += 1) {
            const base = offset + index * 4;
            words[index] =
                (((source[base] ?? 0) << 24) |
                    ((source[base + 1] ?? 0) << 16) |
                    ((source[base + 2] ?? 0) << 8) |
                    (source[base + 3] ?? 0)) >>>
                0;
        }
        for (let index = 16; index < 64; index += 1) {
            const first = words[index - 15] ?? 0;
            const second = words[index - 2] ?? 0;
            const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
            const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
            words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
        }
        let a = state[0] ?? 0;
        let b = state[1] ?? 0;
        let c = state[2] ?? 0;
        let d = state[3] ?? 0;
        let e = state[4] ?? 0;
        let f = state[5] ?? 0;
        let g = state[6] ?? 0;
        let h = state[7] ?? 0;
        for (let index = 0; index < 64; index += 1) {
            const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temporary1 = (h + sum1 + choice + (constants[index] ?? 0) + (words[index] ?? 0)) >>> 0;
            const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }
        state[0] = ((state[0] ?? 0) + a) >>> 0;
        state[1] = ((state[1] ?? 0) + b) >>> 0;
        state[2] = ((state[2] ?? 0) + c) >>> 0;
        state[3] = ((state[3] ?? 0) + d) >>> 0;
        state[4] = ((state[4] ?? 0) + e) >>> 0;
        state[5] = ((state[5] ?? 0) + f) >>> 0;
        state[6] = ((state[6] ?? 0) + g) >>> 0;
        state[7] = ((state[7] ?? 0) + h) >>> 0;
    };

    /**
     * Folds bytes into the compression state. `hex()` calls this for the padding block, so it
     * is deliberately separate from the guarded `update` below: a `finalized` flag that is set
     * *before* absorbing the padding would silently skip the final block and make every digest
     * wrong (the state would still hold the SHA-256 initial value for inputs under 64 bytes).
     */
    const absorb = (bytes: Uint8Array): void => {
        totalLength += bytes.length;
        let index = 0;
        if (blockLength > 0) {
            const needed = Math.min(64 - blockLength, bytes.length);
            block.set(bytes.subarray(0, needed), blockLength);
            blockLength += needed;
            index = needed;
            if (blockLength === 64) {
                compress(block, 0);
                blockLength = 0;
            }
        }
        for (; index + 64 <= bytes.length; index += 64) {
            compress(bytes, index);
        }
        if (index < bytes.length) {
            block.set(bytes.subarray(index), 0);
            blockLength = bytes.length - index;
        }
    };

    const update = (bytes: Uint8Array): void => {
        if (finalized) {
            return;
        }
        absorb(bytes);
    };

    const hex = (): string => {
        if (!finalized) {
            finalized = true;
            const bitLength = totalLength * 8;
            const padding = blockLength < 56 ? 56 - blockLength : 120 - blockLength;
            const tail = new Uint8Array(padding + 8);
            tail[0] = 0x80;
            const high = Math.floor(bitLength / 0x100000000);
            const low = bitLength >>> 0;
            tail[padding] = (high >>> 24) & 0xff;
            tail[padding + 1] = (high >>> 16) & 0xff;
            tail[padding + 2] = (high >>> 8) & 0xff;
            tail[padding + 3] = high & 0xff;
            tail[padding + 4] = (low >>> 24) & 0xff;
            tail[padding + 5] = (low >>> 16) & 0xff;
            tail[padding + 6] = (low >>> 8) & 0xff;
            tail[padding + 7] = low & 0xff;
            absorb(tail);
        }
        return state.map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
    };

    return { update, hex };
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const base64At = (index: number): string => BASE64_ALPHABET.charAt(index);

/**
 * 4096 two-character groups indexed by 12 bits, so one table lookup yields the two base64
 * symbols for a half-group. Built lazily: the web bundle imports this module for `checkForUpdate`
 * and never encodes a byte.
 */
let base64Pairs: ReadonlyArray<string> | null = null;
const base64Pair = (index: number): string => {
    if (base64Pairs === null) {
        const pairs: string[] = new Array<string>(4096);
        for (let value = 0; value < 4096; value += 1) {
            pairs[value] = `${base64At(value >> 6)}${base64At(value & 63)}`;
        }
        base64Pairs = pairs;
    }
    return base64Pairs[index] ?? '';
};

/**
 * Encodes 3 bytes into 4 base64 symbols per iteration and hands each bounded chunk to the caller
 * instead of accumulating the whole payload.
 *
 * Memory: an earlier revision staged incoming bytes in a `number[]` (one boxed JS number per
 * byte, so a 1 MB chunk cost several MB on its own) and then built the entire base64 string in one
 * accumulator, which for a 100 MB APK meant 133 MB of characters held in one string, flattened
 * again for the bridge, serialised again to JSON and received again as a Java `String`. The peak
 * was several times the asset size, which is an out-of-memory condition on the low-memory devices
 * this app targets rather than a slow path.
 *
 * `push` returns whatever whole chunks the incoming bytes completed, so a single oversized network
 * chunk cannot smuggle a large string past the bound. The flush happens inside the emit loop
 * rather than by slicing the buffer afterwards: slicing would re-flatten the accumulated rope on
 * every flush and turn the transfer quadratic in the payload size.
 *
 * The bound is a multiple of four, so the buffer is only ever released at a whole base64 group
 * boundary and only `finish` emits `=` padding. A padded chunk followed by further data is not
 * valid base64, and the native plugin would refuse the whole file.
 */
const createBase64Encoder = (): { push: (bytes: Uint8Array) => readonly string[]; finish: () => string } => {
    let encoded = '';
    // Trailing bytes that cannot form a 3-byte group yet: at most two, so the group never
    // overflows the 24 bits of `accumulator`.
    let accumulator = 0;
    let pending = 0;

    const appendGroup = (group: number, chunks: string[]): void => {
        encoded += `${base64Pair((group >>> 12) & 0xfff)}${base64Pair(group & 0xfff)}`;
        if (encoded.length >= BASE64_WRITE_CHUNK_CHARS) {
            chunks.push(encoded);
            encoded = '';
        }
    };

    return {
        push: (bytes: Uint8Array): readonly string[] => {
            const chunks: string[] = [];
            const length = bytes.length;
            let index = 0;
            if (pending > 0) {
                const needed = 3 - pending;
                const taken = Math.min(needed, length);
                for (let offset = 0; offset < taken; offset += 1) {
                    accumulator = (accumulator << 8) | (bytes[offset] ?? 0);
                }
                pending += taken;
                index = taken;
                if (pending < 3) {
                    return chunks;
                }
                appendGroup(accumulator & 0xffffff, chunks);
                accumulator = 0;
                pending = 0;
            }
            const groupEnd = length - ((length - index) % 3);
            for (let cursor = index; cursor < groupEnd; cursor += 3) {
                const group = ((bytes[cursor] ?? 0) << 16) | ((bytes[cursor + 1] ?? 0) << 8) | (bytes[cursor + 2] ?? 0);
                appendGroup(group & 0xffffff, chunks);
            }
            for (let cursor = groupEnd; cursor < length; cursor += 1) {
                accumulator = (accumulator << 8) | (bytes[cursor] ?? 0);
                pending += 1;
            }
            return chunks;
        },
        finish: (): string => {
            if (pending === 1) {
                const single = accumulator & 0xff;
                encoded += `${base64At((single >> 2) & 63)}${base64At((single & 3) << 4)}==`;
            } else if (pending === 2) {
                const pair = accumulator & 0xffff;
                encoded += `${base64At((pair >> 10) & 63)}${base64At((pair >> 4) & 63)}${base64At((pair << 2) & 63)}=`;
            }
            accumulator = 0;
            pending = 0;
            const tail = encoded;
            encoded = '';
            return tail;
        },
    };
};

const isAndroidPlatform = (): boolean => isAndroidInstallTarget();

const parseContentLength = (value: string | null): number | null | undefined => {
    if (value === null || value === undefined) {
        return undefined;
    }
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
        return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
};

export const downloadAndInstallUpdate = async (
    source: UpdateDownloadSource,
    second?: ((progress: number) => void) | UpdateDownloadOptions,
    third?: ((phase: DownloadPhase) => void) | string,
    fourth?: number,
    fifth?: string,
): Promise<UpdateInstallResult> => {
    const options = normalizeDownloadArguments(second, third, fourth, fifth);
    const metadata = sourceFrom(source);
    const onProgress = options.onProgress ?? (() => undefined);
    const onPhase = options.onPhase ?? (() => undefined);
    const url = metadata.url;
    const nameFromUrl = url ? assetNameFromUrl(url) : null;
    const assetName = options.assetName ?? metadata.assetName ?? nameFromUrl ?? undefined;
    const expectedSha256 = normalizeDigest(options.expectedSha256 ?? metadata.sha256);
    const expectedSize = options.expectedSize ?? metadata.size;
    let verifiedSha256: string | undefined;
    let downloadedSize = 0;

    if (!isAndroidPlatform()) {
        return { success: false, error: NOT_ANDROID_ERROR, assetName };
    }
    if (!url || !isAllowedReleaseUrl(url)) {
        return { success: false, error: 'The update URL is not an approved HTTPS GitHub URL.', assetName };
    }
    if (!assetName || !isApkName(assetName)) {
        return { success: false, error: NOT_APK_ERROR };
    }
    if (nameFromUrl !== null && nameFromUrl !== assetName) {
        return { success: false, error: 'The update asset name does not match the download URL.' };
    }
    if (!expectedSha256) {
        return { success: false, error: DIGEST_REQUIRED_ERROR, assetName };
    }
    if (expectedSize !== undefined && (!validSize(expectedSize) || expectedSize > MAX_UPDATE_SIZE_BYTES)) {
        return { success: false, error: TOO_LARGE_ERROR, assetName, size: expectedSize };
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    // The response phase is bounded by REQUEST_TIMEOUT_MS; the body phase gets a much
    // longer stall budget that is re-armed on every received chunk so a slow but
    // progressing multi-megabyte APK is not aborted mid-transfer.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    /**
     * Set when a deadline released the caller while the transfer was still running. Only the
     * download deadline does this: the install deadline deliberately does not, because the
     * platform installer may already be reading the file and must be allowed to finish.
     *
     * Without this flag the abandoned transfer kept going in the background - writing to the
     * filesystem and, on the no-`AbortController` path, eventually calling the installer long
     * after the caller had been told the update failed. A user who then retried got two
     * installer launches for one download.
     */
    let abandoned = false;
    const armTimeout = (milliseconds: number): void => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            timedOut = true;
            controller?.abort();
        }, milliseconds);
    };
    const requestInit: RequestInit = { redirect: 'follow', credentials: 'omit', cache: 'no-store' };
    if (controller) {
        requestInit.signal = controller.signal;
    }
    armTimeout(REQUEST_TIMEOUT_MS);

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let streamComplete = false;
    // Whether any byte has reached the filesystem yet, which is what makes a cleanup delete
    // meaningful. Set before the call, not after, so a write that half-succeeded is still removed.
    let storeStarted = false;
    const ensureActive = (): void => {
        if (abandoned) {
            throw new Error(ABANDONED_ERROR);
        }
    };
    /**
     * Removes a half-written APK. Best effort by design: a device that cannot delete its own cache
     * entry has bigger problems than a stale file, and the next attempt overwrites the same fixed
     * path, so at most one copy can ever exist.
     */
    const discardStoredApk = async (): Promise<void> => {
        if (!storeStarted) {
            return;
        }
        storeStarted = false;
        try {
            await Filesystem.deleteFile({ path: CACHE_FILE_NAME, directory: Directory.Cache });
        } catch {
            return;
        }
    };
    /**
     * Writes one base64 chunk, creating the file on the first call and appending after that.
     * `writeFile` truncates, so a previous attempt's leftovers are discarded rather than being
     * appended to and producing a file that is neither the old APK nor the new one.
     */
    const writeChunk = async (chunk: string): Promise<void> => {
        ensureActive();
        if (storeStarted) {
            await Filesystem.appendFile({ path: CACHE_FILE_NAME, directory: Directory.Cache, data: chunk });
            return;
        }
        storeStarted = true;
        const written = await Filesystem.writeFile({
            path: CACHE_FILE_NAME,
            directory: Directory.Cache,
            data: chunk,
            recursive: true,
        });
        if (!isPlainRecord(written) || (written.uri !== undefined && typeof written.uri !== 'string')) {
            throw new Error('The verified APK could not be stored for installation.');
        }
    };

    const transfer = async (): Promise<UpdateInstallResult> => {
        onPhase('downloading');
        const response = await fetch(url, requestInit);
        if (response.url && !isAllowedReleaseUrl(response.url)) {
            discardBody(response);
            return { success: false, error: 'The update redirected to an unapproved host.', assetName };
        }
        if (!response.ok) {
            discardBody(response);
            return { success: false, error: `Failed to download update (HTTP ${response.status}).`, assetName };
        }
        // Lock the body immediately so every early return below still releases the connection.
        reader = response.body?.getReader();
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        if (contentType.startsWith('text/') || contentType.includes('application/json')) {
            return { success: false, error: NOT_AN_APK_ERROR, assetName };
        }
        const contentLength = parseContentLength(response.headers.get('content-length'));
        if (contentLength === null) {
            return { success: false, error: 'The update response has an invalid size.', assetName };
        }
        if (contentLength !== undefined && contentLength > MAX_UPDATE_SIZE_BYTES) {
            return { success: false, error: TOO_LARGE_ERROR, assetName, size: contentLength };
        }
        if (expectedSize !== undefined && contentLength !== undefined && contentLength !== expectedSize) {
            return { success: false, error: SIZE_MISMATCH_ERROR, assetName, size: contentLength };
        }

        if (!reader) {
            return { success: false, error: UNREADABLE_RESPONSE_ERROR, assetName };
        }
        armTimeout(DOWNLOAD_TIMEOUT_MS);
        const hasher = createSha256();
        const encoder = createBase64Encoder();
        const prefix: number[] = [];
        let emptyReads = 0;
        // The APK is appended to disk while it downloads rather than after it has been verified.
        // That is what keeps the peak bounded (see `BASE64_WRITE_CHUNK_CHARS`), and it is safe
        // because of two properties: the file lives in the app's own cache, where nothing outside
        // this process can reach it, and it is only ever named to the installer once its SHA-256
        // has matched. Every other outcome removes it again before returning, so the cleanup is in
        // a `finally` rather than a `catch`: most of the refusals below are plain `return`s, which
        // would otherwise sail straight past a handler meant for throws.
        let completeOnDisk = false;
        try {
            while (true) {
                const result = await reader.read();
                if (result.done) {
                    streamComplete = true;
                    break;
                }
                if (!result.value || result.value.length === 0) {
                    emptyReads += 1;
                    if (emptyReads > MAX_EMPTY_STREAM_READS) {
                        return { success: false, error: UNREADABLE_RESPONSE_ERROR, assetName, size: downloadedSize };
                    }
                    continue;
                }
                emptyReads = 0;
                if (downloadedSize + result.value.length > MAX_UPDATE_SIZE_BYTES) {
                    return {
                        success: false,
                        error: TOO_LARGE_ERROR,
                        assetName,
                        size: downloadedSize + result.value.length,
                    };
                }
                downloadedSize += result.value.length;
                // GitHub metadata already states the exact asset size, so a stream that keeps
                // delivering past it is hostile or broken. Stopping here rather than waiting for the
                // 100 MB ceiling means a lying `content-length` cannot pin a socket and a heap.
                if (expectedSize !== undefined && downloadedSize > expectedSize) {
                    return { success: false, error: SIZE_MISMATCH_ERROR, assetName, size: downloadedSize };
                }
                for (let index = 0; index < result.value.length && prefix.length < APK_ZIP_MAGIC.length; index += 1) {
                    prefix.push(result.value[index] ?? 0);
                }
                hasher.update(result.value);
                const chunks = encoder.push(result.value);
                armTimeout(DOWNLOAD_TIMEOUT_MS);
                const total = expectedSize ?? contentLength;
                if (total !== undefined && total > 0) {
                    onProgress(Math.min(99, Math.round((downloadedSize / total) * 100)));
                }
                for (const chunk of chunks) {
                    await writeChunk(chunk);
                }
            }
            if (downloadedSize === 0) {
                return { success: false, error: EMPTY_RESPONSE_ERROR, assetName };
            }
            // Truncation is caught against whichever length was actually declared, so a body that
            // stops early is refused even when the release published no size at all.
            if (expectedSize !== undefined && downloadedSize !== expectedSize) {
                return { success: false, error: SIZE_MISMATCH_ERROR, assetName, size: downloadedSize };
            }
            if (contentLength !== undefined && downloadedSize !== contentLength) {
                return { success: false, error: SIZE_MISMATCH_ERROR, assetName, size: downloadedSize };
            }
            if (prefix.length !== APK_ZIP_MAGIC.length || prefix.some((byte, index) => byte !== APK_ZIP_MAGIC[index])) {
                return { success: false, error: NOT_AN_APK_ERROR, assetName, size: downloadedSize };
            }
            const actualSha256 = hasher.hex();
            if (actualSha256 !== expectedSha256) {
                return {
                    success: false,
                    error: HASH_MISMATCH_ERROR,
                    assetName,
                    sha256: actualSha256,
                    size: downloadedSize,
                };
            }
            // The remainder is at most one padded group, so the file is complete only after it.
            const tail = encoder.finish();
            if (tail.length > 0) {
                await writeChunk(tail);
            }
            verifiedSha256 = actualSha256;
            onProgress(100);
            completeOnDisk = true;
        } finally {
            if (!completeOnDisk) {
                await discardStoredApk();
            }
        }
        // From here the file on disk is complete and its digest matches the published one, so it
        // is never deleted: the installer reads it through a FileProvider, and removing it during
        // a slow install would abort an install that is already under way.
        const installVerifiedApk = async (): Promise<UpdateInstallResult> => {
            ensureActive();
            const permission = await NativeAppUpdate.checkInstallPermission();
            if (!isInstallPermissionGranted(permission)) {
                // The verified APK is deliberately left in place. The dialog offers a retry the
                // moment the grant comes back, and re-downloading tens of megabytes to satisfy a
                // permission the user has not granted yet would be the worse trade.
                return {
                    success: false,
                    error: INSTALL_PERMISSION_ERROR,
                    assetName,
                    sha256: verifiedSha256,
                    size: downloadedSize,
                };
            }
            onPhase('installing');
            await NativeAppUpdate.installApk({ path: CACHE_FILE_NAME });
            onPhase('success');
            return { success: true, assetName, sha256: verifiedSha256, size: downloadedSize };
        };
        // The request is finished, so the abort timer is disarmed rather than left pointing at a
        // completed download; `withDeadline` alone owns the install budget from here.
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
        return withDeadline(installVerifiedApk(), INSTALL_TIMEOUT_MS, () => {
            timedOut = true;
        });
    };

    try {
        // With an AbortController the stall timer cancels the request itself. Without one there is
        // nothing to cancel, so the caller is released on the same budget and the transfer is
        // marked abandoned: it keeps draining whatever the socket still delivers, but it stops
        // before the next write, before the permission probe and before the installer, and removes
        // the partial file on its way out. Letting it run to completion instead meant a retry could
        // launch a second installer behind a caller that had already been told the update failed.
        return controller
            ? await transfer()
            : await withDeadline(transfer(), DOWNLOAD_TIMEOUT_MS, () => {
                  timedOut = true;
                  abandoned = true;
              });
    } catch (error: unknown) {
        const failure =
            timedOut || abandoned ? TIMEOUT_ERROR : isAbortError(error) ? INTERRUPTED_ERROR : GENERIC_FAILURE_ERROR;
        const result: UpdateInstallResult = { success: false, error: failure, assetName };
        if (verifiedSha256 !== undefined) {
            result.sha256 = verifiedSha256;
        }
        if (downloadedSize > 0) {
            result.size = downloadedSize;
        }
        return result;
    } finally {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        if (reader && !streamComplete) {
            cancelReader(reader);
        }
    }
};

export const clearUpdateCache = (): void => {
    try {
        if (typeof localStorage === 'undefined') {
            return;
        }
        for (const key of [CACHE_KEY, ...LEGACY_CACHE_KEYS]) {
            localStorage.removeItem(key);
        }
    } catch {
        return;
    }
};

export const getCurrentVersion = (): string => CURRENT_VERSION;
