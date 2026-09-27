import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    native: true,
    platform: 'android',
    hasGetPlatform: true,
    fetch: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    deleteFile: vi.fn(),
    checkInstallPermission: vi.fn(),
    openInstallPermissionSettings: vi.fn(),
    installApk: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => mocks.native,
        // A getter so a test can hide `getPlatform` entirely; the service reads it per call.
        get getPlatform() {
            return mocks.hasGetPlatform ? () => (mocks.native ? mocks.platform : 'web') : undefined;
        },
    },
    // Lets `vi.importActual` load the real NativeAppUpdate module, so the permission predicate
    // under test is the shipped one rather than a copy.
    registerPlugin: () => ({}),
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: { Cache: 'CACHE' },
    Filesystem: {
        writeFile: mocks.writeFile,
        appendFile: mocks.appendFile,
        deleteFile: mocks.deleteFile,
    },
}));

vi.mock('../native/NativeAppUpdate', async () => {
    const actual = await vi.importActual<typeof import('../native/NativeAppUpdate')>('../native/NativeAppUpdate');
    return {
        ...actual,
        default: {
            checkInstallPermission: mocks.checkInstallPermission,
            openInstallPermissionSettings: mocks.openInstallPermissionSettings,
            installApk: mocks.installApk,
        },
    };
});

import packageJson from '../../package.json';
import { isInstallPermissionGranted } from '../native/NativeAppUpdate';
import {
    checkForUpdate,
    clearUpdateCache,
    DOWNLOAD_TIMEOUT_MS,
    downloadAndInstallUpdate,
    getCurrentVersion,
    INSTALL_TIMEOUT_MS,
    isAllowedGithubApiUrl,
    isAllowedReleaseUrl,
    isAllowedUpdateUrl,
    MAX_UPDATE_SIZE_BYTES,
} from './updateService';

const REPO = 'sumon317/DailyStudyTracker';
const CACHE_KEY = 'update_check_cache:v2';
const APK_URL = `https://github.com/${REPO}/releases/download/v9.0.0/app.apk`;
/** The release page the feed reports for `tag`, i.e. what the service falls back to. */
const releasePageFor = (tag: string): string => `https://github.com/${REPO}/releases/tag/${tag}`;
const RELEASE_PAGE = releasePageFor('v99.0.0');
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const DAY_MS = 24 * 60 * 60 * 1000;
const SHA256_INITIAL_STATE = '6a09e667bb67ae853c6ef372a54ff53a510e527f9b05688c1f83d9ab5be0cd19';

/**
 * A byte buffer that the DOM lib accepts as a `BufferSource`.
 *
 * `BufferSource` is `ArrayBufferView<ArrayBuffer>`, and a bare `Uint8Array` is
 * `Uint8Array<ArrayBufferLike>` - its backing buffer may be a
 * `SharedArrayBuffer`, which the platform APIs here refuse. Every buffer in
 * this file is produced by `new Uint8Array(...)` or `TextEncoder`, both of
 * which are backed by a plain `ArrayBuffer`, so the alias records that once
 * instead of casting at every call site.
 */
type Bytes = Uint8Array<ArrayBuffer>;

const encode = (value: string): Bytes => new TextEncoder().encode(value);
const decode = (value: Bytes): string => new TextDecoder().decode(value);

const toHex = (buffer: ArrayBuffer): string =>
    Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

const sha256 = async (bytes: Bytes): Promise<string> => toHex(await crypto.subtle.digest('SHA-256', bytes));

const toBase64 = (bytes: Bytes): string => {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
};

const fromBase64 = (value: string): Bytes => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

/** Builds a payload that starts with the ZIP local-file header so the magic check can pass. */
const apkBytes = (length: number, seed = 7): Bytes => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
        bytes[index] = index < ZIP_MAGIC.length ? (ZIP_MAGIC[index] ?? 0) : (index * 31 + seed) & 0xff;
    }
    return bytes;
};

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
    });

const releaseResponse = (tag: string, assets: unknown[] = [], extra: Record<string, unknown> = {}): Response =>
    jsonResponse({
        tag_name: tag,
        html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
        body: 'notes',
        assets,
        ...extra,
    });

const apkAsset = (name: string, digest: string, size: number, base = 'https://github.com') => ({
    name,
    browser_download_url: `${base}/${REPO}/releases/download/v9.0.0/${name}`,
    size,
    digest: `sha256:${digest}`,
});

const apkSource = (overrides: Record<string, unknown> = {}) => ({
    available: true,
    url: APK_URL,
    assetName: 'app.apk',
    sha256: 'a'.repeat(64),
    size: 4,
    ...overrides,
});

const octetStream = (bytes: Bytes, headers: Record<string, string> = {}): Response =>
    new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', ...headers },
    });

/** A response object with no `content-length`, so only the streaming cap can stop it. */
const lengthlessStream = (
    read: () => Promise<{ done: boolean; value?: Uint8Array }>,
    cancel: () => unknown = () => Promise.resolve(),
): { ok: boolean; status: number; url: string; headers: Headers; body: unknown } => ({
    ok: true,
    status: 200,
    url: '',
    headers: new Headers({ 'content-type': 'application/octet-stream' }),
    body: { getReader: () => ({ read, cancel }) },
});

interface WriteCall {
    path: string;
    directory: string;
    data: string;
}

/**
 * Every base64 payload handed to the filesystem bridge, in the order the service sent them.
 *
 * The APK is appended rather than written in one call, so a single-call read would only ever see
 * the first chunk. The service always writes first and only appends afterwards, and
 * `invocationCallOrder` is what puts the two mock functions back into one sequence.
 */
const storedChunks = (): string[] => {
    const writes = [
        ...mocks.writeFile.mock.calls.map((call, index) => ({
            order: mocks.writeFile.mock.invocationCallOrder[index] ?? 0,
            data: (call[0] as WriteCall).data,
        })),
        ...mocks.appendFile.mock.calls.map((call, index) => ({
            order: mocks.appendFile.mock.invocationCallOrder[index] ?? 0,
            data: (call[0] as WriteCall).data,
        })),
    ].sort((left, right) => left.order - right.order);
    if (writes.length === 0) {
        throw new Error('the verified APK was never written');
    }
    return writes.map((write) => write.data);
};

const storedBase64 = (): string => storedChunks().join('');

const writeCallCount = (): number => mocks.writeFile.mock.calls.length + mocks.appendFile.mock.calls.length;

const seedCache = (result: Record<string, unknown>, ageMs = 0): void => {
    localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ schema: 2, version: packageJson.version, timestamp: Date.now() - ageMs, result }),
    );
};

/** Runs `body` against a freshly imported copy of the service pinned to `version`. */
const withPackageVersion = async (
    version: string,
    body: (service: typeof import('./updateService')) => Promise<void>,
) => {
    vi.resetModules();
    vi.doMock('../../package.json', () => ({ default: { version } }));
    try {
        const service = await import('./updateService');
        await body(service);
    } finally {
        vi.doUnmock('../../package.json');
        vi.resetModules();
    }
};

/**
 * The one reset every suite in this file starts from.
 *
 * `vi.clearAllMocks()` clears recorded calls, *not* implementations, and these
 * mocks are created once in `vi.hoisted` - so a `mockResolvedValue` or a
 * `mockRejectedValueOnce` left behind by whichever test ran last would still be
 * in force for the next one. That is the whole of this file's order sensitivity,
 * and it is why the reset enumerates the mocks rather than leaning on
 * `clearAllMocks`. Sharing one function also means a new suite in this file
 * cannot accidentally get a weaker reset than the others.
 */
const resetServiceMocks = (): void => {
    mocks.native = true;
    mocks.platform = 'android';
    mocks.hasGetPlatform = true;
    vi.clearAllMocks();
    mocks.fetch.mockReset();
    mocks.writeFile.mockReset();
    mocks.appendFile.mockReset();
    mocks.deleteFile.mockReset();
    mocks.checkInstallPermission.mockReset();
    mocks.openInstallPermissionSettings.mockReset();
    mocks.installApk.mockReset();
    mocks.writeFile.mockResolvedValue({ uri: 'file:///cache/update.apk' });
    mocks.appendFile.mockResolvedValue(undefined);
    mocks.deleteFile.mockResolvedValue(undefined);
    mocks.checkInstallPermission.mockResolvedValue({ granted: true });
    mocks.installApk.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', mocks.fetch);
    clearUpdateCache();
};

describe('update URL allowlist', () => {
    it('accepts only the release download paths this project publishes', () => {
        expect(isAllowedReleaseUrl(APK_URL)).toBe(true);
        expect(isAllowedReleaseUrl(`https://github.com/${REPO}/releases/tag/v9.0.0`)).toBe(true);
        expect(
            isAllowedReleaseUrl(
                'https://release-assets.githubusercontent.com/github-production-release-asset/uuid?sp=a',
            ),
        ).toBe(true);
        // Percent-encoding is normal in a published asset name and must not be mistaken for a
        // traversal attempt; only encoded *dots* and backslashes are refused.
        expect(isAllowedReleaseUrl(`https://github.com/${REPO}/releases/download/v9.0.0/My%20App.apk`)).toBe(true);
        expect(isAllowedReleaseUrl(`https://github.com/${REPO}/releases/download/v9.0.0/app.apk?token=abc`)).toBe(true);
        expect(isAllowedReleaseUrl(`https://GITHUB.COM/${REPO}/releases/download/v9.0.0/app.apk`)).toBe(true);
        expect(isAllowedReleaseUrl(`https://github.com:443/${REPO}/releases/download/v9.0.0/app.apk`)).toBe(true);
    });

    it.each([
        ['plaintext', 'http://github.com/sumon317/DailyStudyTracker/releases/download/v9.0.0/app.apk'],
        ['a foreign host', 'https://evil.example/app.apk'],
        ['a suffixed lookalike host', 'https://github.com.evil.example/app.apk'],
        ['embedded credentials', 'https://user:pass@github.com/sumon317/DailyStudyTracker/releases/download/v/app.apk'],
        ['a non standard port', 'https://github.com:8443/sumon317/DailyStudyTracker/releases/download/v/app.apk'],
        ['a fragment', 'https://github.com/sumon317/DailyStudyTracker/releases/download/v/app.apk#x'],
        ['a different repository', 'https://github.com/attacker/DailyStudyTracker/releases/download/v/app.apk'],
        ['a non release path', 'https://github.com/sumon317/DailyStudyTracker/raw/main/app.apk'],
        ['an encoded traversal', 'https://github.com/sumon317/DailyStudyTracker/releases/download/v/%2e%2e/app.apk'],
        [
            'an uppercase encoded traversal',
            'https://github.com/sumon317/DailyStudyTracker/releases/download/v/%2E%2E/app.apk',
        ],
        [
            'an encoded separator traversal',
            'https://github.com/sumon317/DailyStudyTracker/releases/download/v/a%2f..%2f..%2fapp.apk',
        ],
        ['a decoded traversal', 'https://github.com/sumon317/DailyStudyTracker/releases/../../attacker/app.apk'],
        ['a backslash path', 'https://github.com/sumon317\\DailyStudyTracker/releases/download/v/app.apk'],
        ['an encoded backslash', 'https://github.com/sumon317%5cDailyStudyTracker/releases/download/v/app.apk'],
        ['a legacy asset host', 'https://objects.githubusercontent.com/nwo/app.apk'],
        [
            'a lookalike asset host',
            'https://release-assets.githubusercontent.com.evil.example/github-production-release-asset/uuid',
        ],
        ['the api host', 'https://api.github.com/repos/sumon317/DailyStudyTracker/releases/latest'],
        ['a trailing dot host', 'https://github.com./sumon317/DailyStudyTracker/releases/download/v/app.apk'],
        ['a loopback host', 'https://127.0.0.1/sumon317/DailyStudyTracker/releases/download/v/app.apk'],
        ['a punycode lookalike', 'https://xn--ghub-hia.com/sumon317/DailyStudyTracker/releases/download/v/app.apk'],
        ['a javascript scheme', 'javascript:alert(1)//sumon317/DailyStudyTracker/releases/download/v/app.apk'],
        ['a data scheme', 'data:text/plain,hello//sumon317/DailyStudyTracker/releases/download/v/app.apk'],
        ['an embedded newline', 'https://github.com/sumon317\n/DailyStudyTracker/releases/download/v/app.apk'],
        ['an invalid escape', 'https://github.com/sumon317/%zz/DailyStudyTracker/releases/download/v/app.apk'],
        ['an empty string', ''],
        ['an over long url', `https://github.com/${REPO}/releases/download/v9.0.0/${'a'.repeat(2100)}.apk`],
        ['a non string', 42 as unknown as string],
    ])('rejects %s', (_label, value) => {
        expect(isAllowedReleaseUrl(value)).toBe(false);
    });

    it('separates the api allowlist from the release allowlist', () => {
        const apiUrl = `https://api.github.com/repos/${REPO}/releases/latest`;
        expect(isAllowedGithubApiUrl(apiUrl)).toBe(true);
        expect(isAllowedUpdateUrl(apiUrl, 'api')).toBe(true);
        expect(isAllowedUpdateUrl(apiUrl, 'release')).toBe(false);
        expect(isAllowedGithubApiUrl(`https://api.github.com/repos/${REPO}/releases`)).toBe(false);
        expect(
            isAllowedGithubApiUrl(`https://api.github.com/repos/attacker/${'DailyStudyTracker'}/releases/latest`),
        ).toBe(false);
        expect(isAllowedGithubApiUrl(`https://api.github.com.evil.example/repos/${REPO}/releases/latest`)).toBe(false);
    });
});

describe('checkForUpdate', () => {
    beforeEach(resetServiceMocks);

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('returns the current package version', () => {
        expect(getCurrentVersion()).toBe(packageJson.version);
        expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('does not check for updates on the web', async () => {
        mocks.native = false;
        await expect(checkForUpdate(true)).resolves.toEqual({ available: false });
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('reads APK digest and size metadata from the latest release', async () => {
        const digest = await sha256(encode('apk'));
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [apkAsset('DailyStudyTracker-v99.0.0.apk', digest, 7)]),
        );
        const result = await checkForUpdate(true);
        expect(result).toMatchObject({
            available: true,
            tag: 'v99.0.0',
            url: `https://github.com/${REPO}/releases/download/v9.0.0/DailyStudyTracker-v99.0.0.apk`,
            assetName: 'DailyStudyTracker-v99.0.0.apk',
            sha256: digest,
            size: 7,
        });
    });

    it('prefers the versioned release APK over any other APK in the same release', async () => {
        const wanted = await sha256(encode('wanted'));
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [
                apkAsset('zz-decoy.apk', await sha256(encode('decoy')), 3),
                apkAsset('DailyStudyTracker-v99.0.0.apk', wanted, 9),
            ]),
        );
        await expect(checkForUpdate(true)).resolves.toMatchObject({
            assetName: 'DailyStudyTracker-v99.0.0.apk',
            sha256: wanted,
        });
    });

    it('ranks a prerelease asset by its full tag, not only the core version', async () => {
        const wanted = await sha256(encode('rc'));
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0-rc.1', [
                apkAsset('zz-decoy.apk', await sha256(encode('decoy')), 3),
                apkAsset('DailyStudyTracker-v99.0.0-rc.1.apk', wanted, 9),
            ]),
        );
        await withPackageVersion('98.0.0-rc.1', async (service) => {
            await expect(service.checkForUpdate(true)).resolves.toMatchObject({
                assetName: 'DailyStudyTracker-v99.0.0-rc.1.apk',
                sha256: wanted,
            });
        });
    });

    it('picks the same asset no matter how a release orders its assets', async () => {
        const a = apkAsset('Alpha-v99.0.0.apk', 'a'.repeat(64), 1);
        const b = apkAsset('Beta-v99.0.0.apk', 'b'.repeat(64), 2);
        const forwards = await (async () => {
            mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0', [a, b]));
            return (await checkForUpdate(true)).assetName;
        })();
        const backwards = await (async () => {
            mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0', [b, a]));
            return (await checkForUpdate(true)).assetName;
        })();
        expect(forwards).toBe(backwards);
    });

    // The rows deliberately have different shapes (some carry a `url` to
    // mismatch, some do not), so the parameter is annotated rather than inferred
    // from the first row: an inferred union would make `override.url` a type
    // error on exactly the rows the test exists to cover.
    it.each([
        ['a name that does not match its download URL', { name: 'app.apk', url: 'other.apk' }],
        ['a traversal in the name', { name: '../app.apk' }],
        ['a hidden apk name', { name: '.apk' }],
        ['an oversized name', { name: `${'a'.repeat(70)}.apk` }],
        ['a non string name', { name: 42 }],
    ])('ignores an asset with %s', async (_label: string, override: Record<string, unknown>) => {
        const digest = await sha256(encode('real'));
        const base = apkAsset('app.apk', digest, 4);
        const asset = {
            ...base,
            ...override,
            browser_download_url:
                override.url !== undefined
                    ? `https://github.com/${REPO}/releases/download/v9.0.0/${String(override.url)}`
                    : base.browser_download_url,
        };
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0', [asset]));
        const result = await checkForUpdate(true);
        expect(result.available).toBe(true);
        expect(result.assetName).toBeUndefined();
        expect(result.sha256).toBeUndefined();
        expect(result.url).toBe(RELEASE_PAGE);
    });

    it.each([
        ['a digest of the wrong length', 'sha256:abc'],
        ['a digest with no hex', `sha256:${'z'.repeat(64)}`],
        ['a digest for another algorithm', `sha512:${'a'.repeat(64)}`],
        ['a digest with trailing junk', `sha256:${'a'.repeat(64)}x`],
        ['a digest for md5', `md5:${'a'.repeat(32)}`],
        ['a very long digest field', 'a'.repeat(200_000)],
        ['a non string digest', 12345],
        ['a null digest', null],
        ['a digest object', { value: 'a'.repeat(64) }],
    ])('drops an APK that reports %s', async (_label, digest) => {
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [{ ...apkAsset('app.apk', 'a'.repeat(64), 4), digest }]),
        );
        const result = await checkForUpdate(true);
        expect(result).toMatchObject({ assetName: 'app.apk', sha256: undefined });
        // Without a digest the update is not automatically installable, so it must be refused.
        await expect(downloadAndInstallUpdate(result)).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/SHA-256/),
        });
    });

    it('normalises a well formed digest regardless of case or prefix', async () => {
        const digest = await sha256(encode('prefix'));
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [
                { ...apkAsset('app.apk', digest, 4), digest: `SHA256:${digest.toUpperCase()}` },
            ]),
        );
        await expect(checkForUpdate(true)).resolves.toMatchObject({ sha256: digest });
    });

    it('tolerates whitespace around a digest the way the release feed formats it', async () => {
        const digest = await sha256(encode('padded'));
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [{ ...apkAsset('app.apk', digest, 4), digest: `  sha256:${digest}  ` }]),
        );
        await expect(checkForUpdate(true)).resolves.toMatchObject({ sha256: digest });
    });

    it.each([
        ['a string size', '4096'],
        ['a zero size', 0],
        ['a negative size', -1],
        ['an unsafe integer size', 1e30],
        ['a fractional size', 4.5],
        ['a null size', null],
    ])('drops a size reported as %s', async (_label, size) => {
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [{ ...apkAsset('app.apk', 'a'.repeat(64), 4), size }]),
        );
        await expect(checkForUpdate(true)).resolves.toMatchObject({ assetName: 'app.apk', size: undefined });
    });

    it('reports an oversized asset size so the UI can refuse it before downloading', async () => {
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [apkAsset('app.apk', 'a'.repeat(64), MAX_UPDATE_SIZE_BYTES + 1)]),
        );
        const result = await checkForUpdate(true);
        expect(result.size).toBe(MAX_UPDATE_SIZE_BYTES + 1);
        await expect(downloadAndInstallUpdate(result)).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/size limit/i),
        });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('ignores an APK asset whose name does not match its download URL', async () => {
        const digest = await sha256(encode('real'));
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [
                {
                    ...apkAsset('app.apk', digest, 4),
                    browser_download_url: `${APK_URL.replace('app.apk', 'other.apk')}`,
                },
            ]),
        );
        const result = await checkForUpdate(true);
        expect(result.available).toBe(true);
        expect(result.assetName).toBeUndefined();
        expect(result.sha256).toBeUndefined();
        expect(result.url).toBe(RELEASE_PAGE);
    });

    it('falls back to a valid sha256 field when the digest field is malformed', async () => {
        const digest = await sha256(encode('fallback'));
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [
                { ...apkAsset('app.apk', digest, 4), digest: 'sha256:not-a-digest', sha256: digest.toUpperCase() },
            ]),
        );
        await expect(checkForUpdate(true)).resolves.toMatchObject({ sha256: digest });
    });

    it('never points an update at an unapproved download host', async () => {
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [apkAsset('app.apk', await sha256(encode('x')), 4, 'https://evil.example')]),
        );
        const result = await checkForUpdate(true);
        expect(result.url).toBe(RELEASE_PAGE);
        expect(isAllowedReleaseUrl(result.url ?? '')).toBe(true);
    });

    it('never points an update at an unapproved release page', async () => {
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [], {
                html_url: 'https://github.com/attacker/DailyStudyTracker/releases/tag/v99.0.0',
            }),
        );
        const result = await checkForUpdate(true);
        expect(result.url).toBeUndefined();
    });

    it('truncates a hostile asset list instead of walking thousands of entries', async () => {
        const decoys = Array.from({ length: 400 }, (_unused, index) =>
            apkAsset(`zz-decoy-${index}.apk`, 'b'.repeat(64), 1),
        );
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [...decoys, apkAsset('DailyStudyTracker-v99.0.0.apk', 'a'.repeat(64), 9)]),
        );
        const result = await checkForUpdate(true);
        // Only the first 200 assets are considered, so the real APK at index 400 is invisible and a
        // decoy from the retained window wins. Without the cap the versioned asset would rank first.
        expect(result.assetName).toBe('zz-decoy-0.apk');
        expect(result.assetName).not.toBe('DailyStudyTracker-v99.0.0.apk');
    });

    it('keeps an asset that sits inside the retained window', async () => {
        const digest = await sha256(encode('inside'));
        const decoys = Array.from({ length: 150 }, (_unused, index) =>
            apkAsset(`zz-decoy-${index}.apk`, 'b'.repeat(64), 1),
        );
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [...decoys, apkAsset('DailyStudyTracker-v99.0.0.apk', digest, 9)]),
        );
        await expect(checkForUpdate(true)).resolves.toMatchObject({
            assetName: 'DailyStudyTracker-v99.0.0.apk',
            sha256: digest,
        });
    });

    it.each([
        ['an object', { name: 'app.apk' }],
        ['a string', 'app.apk'],
        ['null', null],
        ['a number', 7],
    ])('tolerates an assets field that is %s', async (_label, assets) => {
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0', [], { assets }));
        await expect(checkForUpdate(true)).resolves.toMatchObject({ available: true, assetName: undefined });
    });

    it('ignores non object entries inside the asset array', async () => {
        const digest = await sha256(encode('mixed'));
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [null, 'app.apk', 42, apkAsset('DailyStudyTracker-v99.0.0.apk', digest, 9)]),
        );
        await expect(checkForUpdate(true)).resolves.toMatchObject({
            assetName: 'DailyStudyTracker-v99.0.0.apk',
            sha256: digest,
        });
    });

    it('is not confused by a prototype shaped payload', async () => {
        const body = `{"__proto__":{"available":true,"tag":"v99.0.0"},"tag_name":"v99.0.0","assets":[]}`;
        mocks.fetch.mockResolvedValue(jsonResponse(body));
        const result = await checkForUpdate(true);
        expect(result).toEqual({ available: true, tag: 'v99.0.0' });
        // A polluted prototype would leak a tag into every object in the app.
        expect(({} as Record<string, unknown>).tag).toBeUndefined();
    });

    it('caps release notes so a hostile body cannot flood storage or the modal', async () => {
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0', [], { body: 'x'.repeat(100_000) }));
        const result = await checkForUpdate(true);
        expect(result.notes?.length).toBe(20_000);
    });

    it.each([
        ['a non string body', 42],
        ['a null body', null],
    ])('drops release notes given as %s', async (_label, body) => {
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0', [], { body }));
        await expect(checkForUpdate(true)).resolves.toMatchObject({ notes: undefined });
    });

    it.each([
        ['a forbidden repository', 403],
        ['a rate limited feed', 429],
        ['an unauthorised client', 401],
        ['a moved feed', 301],
    ])('propagates HTTP %s without a cached answer', async (_label, status) => {
        mocks.fetch.mockResolvedValue(new Response(null, { status }));
        await expect(checkForUpdate(true)).rejects.toThrow();
        expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    });

    it('does not hammer the API when it answers 403', async () => {
        mocks.fetch.mockResolvedValue(new Response(null, { status: 403, headers: { 'retry-after': '1' } }));
        await expect(checkForUpdate(true)).rejects.toThrow(/rate limited/i);
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('honours a hostile retry-after without letting it park the app', async () => {
        mocks.fetch.mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '999999999' } }));
        await expect(checkForUpdate(true)).rejects.toThrow(/rate limited/i);
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['an http date', 'Wed, 21 Oct 2099 07:28:00 GMT'],
        ['a date in the past', 'Wed, 21 Oct 2015 07:28:00 GMT'],
        ['gibberish', 'soon'],
    ])('tolerates a retry-after of %s', async (_label, retryAfter) => {
        mocks.fetch.mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': retryAfter } }));
        await expect(checkForUpdate(true)).rejects.toThrow(/rate limited/i);
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('serves a previously verified answer instead of failing while rate limited', async () => {
        seedCache({ available: true, tag: 'v99.0.0', url: RELEASE_PAGE }, 3 * DAY_MS);
        mocks.fetch.mockResolvedValue(new Response(null, { status: 429 }));
        await expect(checkForUpdate()).resolves.toMatchObject({ available: true, tag: 'v99.0.0' });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('still fails a forced check while rate limited, because force asks for the truth', async () => {
        seedCache({ available: true, tag: 'v99.0.0', url: RELEASE_PAGE }, 3 * DAY_MS);
        mocks.fetch.mockResolvedValue(new Response(null, { status: 429 }));
        await expect(checkForUpdate(true)).rejects.toThrow(/rate limited/i);
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('refuses to replay a stale answer beyond the bound', async () => {
        seedCache({ available: true, tag: 'v99.0.0', url: RELEASE_PAGE }, 8 * DAY_MS);
        mocks.fetch.mockResolvedValue(new Response(null, { status: 429 }));
        await expect(checkForUpdate()).rejects.toThrow(/rate limited/i);
    });

    it('caches a definitive 404 as "no update available"', async () => {
        mocks.fetch.mockResolvedValue(new Response(null, { status: 404 }));
        await expect(checkForUpdate(true)).resolves.toEqual({ available: false });
        expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
        await expect(checkForUpdate()).resolves.toEqual({ available: false });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('propagates update-service failures after retries', async () => {
        mocks.fetch.mockResolvedValue(new Response(null, { status: 500 }));
        vi.useFakeTimers();
        try {
            const pending = expect(checkForUpdate(true)).rejects.toThrow(/HTTP 500/);
            await vi.runAllTimersAsync();
            await pending;
        } finally {
            vi.useRealTimers();
        }
        expect(mocks.fetch).toHaveBeenCalledTimes(3);
        expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    });

    it('backs off further between retries rather than retrying at a fixed interval', async () => {
        const attempts: number[] = [];
        mocks.fetch.mockImplementation(() => {
            attempts.push(Date.now());
            return Promise.resolve(new Response(null, { status: 502 }));
        });
        vi.useFakeTimers();
        try {
            const pending = checkForUpdate(true).catch(() => undefined);
            await vi.runAllTimersAsync();
            await pending;
        } finally {
            vi.useRealTimers();
        }
        expect(attempts).toHaveLength(3);
        const firstGap = (attempts[1] ?? 0) - (attempts[0] ?? 0);
        const secondGap = (attempts[2] ?? 0) - (attempts[1] ?? 0);
        expect(firstGap).toBeGreaterThan(0);
        expect(secondGap).toBeGreaterThan(firstGap);
    });

    it('stops retrying once a retryable failure turns into a rate limit', async () => {
        mocks.fetch
            .mockResolvedValueOnce(new Response(null, { status: 500 }))
            .mockResolvedValue(new Response(null, { status: 429 }));
        vi.useFakeTimers();
        try {
            const pending = expect(checkForUpdate(true)).rejects.toThrow(/rate limited/i);
            await vi.runAllTimersAsync();
            await pending;
        } finally {
            vi.useRealTimers();
        }
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['a truncated body', 'not json at all'],
        ['a json array', '[]'],
        ['a json number', '5'],
        ['a json string', '"v9.0.0"'],
        ['a json null', 'null'],
        ['an object without a tag', '{"assets":[]}'],
        ['a non string tag', '{"tag_name":99}'],
        ['an unreadable tag', '{"tag_name":"nightly"}'],
        ['a leading zero tag', '{"tag_name":"v02.2.2"}'],
        ['an empty prerelease tag', '{"tag_name":"v2.2.3-"}'],
        ['a four segment tag', '{"tag_name":"v1.2.3.4"}'],
        ['a lone v', '{"tag_name":"v"}'],
        ['a leading zero prerelease number', '{"tag_name":"v1.2.3-01"}'],
        ['a tag with an underscore', '{"tag_name":"v1.2.3-rc_1"}'],
        ['a tag with a space', '{"tag_name":"v 1.2.3"}'],
        ['an array tag', '{"tag_name":["v9.0.0"]}'],
        ['an object tag', '{"tag_name":{"value":"v9.0.0"}}'],
        ['a negated tag', '{"tag_name":"v-1.2.3"}'],
        ['an oversized tag', `{"tag_name":"v${'9'.repeat(200)}"}`],
    ])('refuses to answer from %s', async (_label, body) => {
        mocks.fetch.mockResolvedValue(jsonResponse(body));
        await expect(checkForUpdate(true)).rejects.toThrow();
        expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    });

    it('accepts a tag with surrounding whitespace and build metadata', async () => {
        mocks.fetch.mockResolvedValue(
            jsonResponse({ tag_name: '  v99.0.0+build.7  ', html_url: RELEASE_PAGE, assets: [] }),
        );
        await expect(checkForUpdate(true)).resolves.toMatchObject({
            available: true,
            tag: '  v99.0.0+build.7  ',
            url: RELEASE_PAGE,
        });
    });

    it('ignores a release page URL that carries whitespace or control characters', async () => {
        mocks.fetch.mockResolvedValue(jsonResponse({ tag_name: 'v99.0.0', html_url: `${RELEASE_PAGE}\n`, assets: [] }));
        const result = await checkForUpdate(true);
        expect(result.url).toBeUndefined();
    });

    it('refuses an oversized metadata body', async () => {
        mocks.fetch.mockResolvedValue(jsonResponse({ tag_name: 'v99.0.0', body: 'x'.repeat(600_000) }));
        await expect(checkForUpdate(true)).rejects.toThrow(/unreadable/i);
    });

    it('refuses a metadata body that lies about its own length', async () => {
        mocks.fetch.mockResolvedValue(
            new Response(`{"tag_name":"v99.0.0","body":"${'x'.repeat(600_000)}"}`, {
                status: 200,
                headers: { 'content-type': 'application/json', 'content-length': '12' },
            }),
        );
        await expect(checkForUpdate(true)).rejects.toThrow(/unreadable/i);
    });

    it('refuses a feed that redirects to another host', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            url: 'https://evil.example/repos/sumon317/DailyStudyTracker/releases/latest',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve('{"tag_name":"v99.0.0"}'),
        });
        await expect(checkForUpdate(true)).rejects.toThrow(/unapproved host/i);
    });

    it('sends no cookies and stores nothing in the HTTP cache', async () => {
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0'));
        await checkForUpdate(true);
        const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
        expect(init.credentials).toBe('omit');
        expect(init.cache).toBe('no-store');
    });

    it('reuses a cached answer that passes every schema check', async () => {
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0'));
        await checkForUpdate(true);
        mocks.fetch.mockClear();
        await expect(checkForUpdate()).resolves.toMatchObject({ available: true, tag: 'v99.0.0' });
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('drops a superseded entry when a fresh answer cannot be cached', async () => {
        // The feed answers "there is a newer release" but with nothing this app may install from:
        // no APK asset passes the allowlist, and the release page is refused.
        seedCache({
            available: true,
            tag: 'v9.0.0',
            url: `${`https://github.com/${REPO}`}/releases/download/v9.0.0/app.apk`,
            assetName: 'app.apk',
            sha256: 'a'.repeat(64),
            size: 4,
        });
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [], {
                html_url: 'https://github.com/attacker/DailyStudyTracker/releases/tag/v99.0.0',
            }),
        );
        const fresh = await checkForUpdate(true);
        expect(fresh).toMatchObject({ available: true, tag: 'v99.0.0', url: undefined });
        // Leaving the previous entry standing would let the next unforced check report v9.0.0 as
        // the newest release, which the feed has already contradicted.
        expect(localStorage.getItem(CACHE_KEY)).toBeNull();
        mocks.fetch.mockClear();
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0'));
        await checkForUpdate();
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('drops the legacy entry too when a fresh answer cannot be cached', async () => {
        localStorage.setItem('update_check_cache', JSON.stringify({ schema: 2, timestamp: Date.now(), result: {} }));
        mocks.fetch.mockResolvedValue(
            releaseResponse('v99.0.0', [], { html_url: 'https://example.com/releases/tag/v99.0.0' }),
        );
        await checkForUpdate(true);
        expect(localStorage.getItem('update_check_cache')).toBeNull();
        expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    });

    it('keeps a superseded entry when the fresh answer is only rate limited', async () => {
        // The rate-limited path deliberately replays the old answer, so it must not be the thing
        // that clears storage.
        seedCache({ available: true, tag: 'v9.0.0', url: RELEASE_PAGE }, 3 * DAY_MS);
        mocks.fetch.mockResolvedValue(new Response(null, { status: 429 }));
        await expect(checkForUpdate()).resolves.toMatchObject({ tag: 'v9.0.0' });
        expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
    });

    it.each([
        [
            'a poisoned download url',
            { available: true, url: 'https://evil.example/app.apk', assetName: 'app.apk', sha256: 'a'.repeat(64) },
        ],
        [
            'an available answer with no url at all',
            { available: true, tag: 'v99.0.0', assetName: 'app.apk', sha256: 'a'.repeat(64) },
        ],
        [
            'a no update answer smuggling install metadata',
            { available: false, url: APK_URL, assetName: 'app.apk', sha256: 'a'.repeat(64) },
        ],
        ['a no update answer smuggling an asset name', { available: false, assetName: 'app.apk' }],
        [
            'a download url that is only http',
            { available: true, url: 'http://github.com/sumon317/DailyStudyTracker/releases/download/v/app.apk' },
        ],
        ['a digest of the wrong length', { available: true, url: APK_URL, sha256: 'abc' }],
        ['an oversized asset name', { available: true, url: APK_URL, assetName: `${'a'.repeat(70)}.apk` }],
        ['an oversized tag', { available: true, url: RELEASE_PAGE, tag: 'v'.repeat(200) }],
        ['an oversized note', { available: true, url: RELEASE_PAGE, notes: 'x'.repeat(30_000) }],
        ['a non integer size', { available: true, url: RELEASE_PAGE, size: 4.5 }],
        ['a non boolean availability flag', { available: 'yes', url: RELEASE_PAGE }],
    ])('ignores a cache entry holding %s', async (_label, result) => {
        seedCache(result);
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0'));
        await expect(checkForUpdate()).resolves.toMatchObject({ available: true, tag: 'v99.0.0' });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        [
            'a foreign schema version',
            { schema: 1, version: packageJson.version, timestamp: Date.now(), result: { available: false } },
        ],
        [
            'a result cached for another app version',
            { schema: 2, version: '0.0.1', timestamp: Date.now(), result: { available: false } },
        ],
        [
            'a stale timestamp',
            {
                schema: 2,
                version: packageJson.version,
                timestamp: Date.now() - 25 * 60 * 60 * 1000,
                result: { available: false },
            },
        ],
        [
            'a forged future timestamp',
            {
                schema: 2,
                version: packageJson.version,
                timestamp: Date.now() + 2 * 60 * 60 * 1000,
                result: { available: false },
            },
        ],
        [
            'an infinite timestamp',
            {
                schema: 2,
                version: packageJson.version,
                timestamp: Number.POSITIVE_INFINITY,
                result: { available: false },
            },
        ],
        [
            'a string timestamp',
            { schema: 2, version: packageJson.version, timestamp: `${Date.now()}`, result: { available: false } },
        ],
        ['a missing result', { schema: 2, version: packageJson.version, timestamp: Date.now() }],
        ['a non object payload', '"available"'],
    ])('ignores a cache envelope with %s', async (_label, entry) => {
        localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0'));
        await expect(checkForUpdate()).resolves.toMatchObject({ available: true });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('survives unreadable storage instead of failing the check', async () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError: storage is disabled');
        });
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0'));
        await expect(checkForUpdate()).resolves.toMatchObject({ available: true, tag: 'v99.0.0' });
        getItem.mockRestore();
    });

    it('survives a full storage quota instead of failing the check', async () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0'));
        await expect(checkForUpdate(true)).resolves.toMatchObject({ available: true, tag: 'v99.0.0' });
        setItem.mockRestore();
    });

    it('clears both the current and the legacy cache keys', () => {
        localStorage.setItem(CACHE_KEY, '{}');
        localStorage.setItem('update_check_cache', '{}');
        clearUpdateCache();
        expect(localStorage.getItem(CACHE_KEY)).toBeNull();
        expect(localStorage.getItem('update_check_cache')).toBeNull();
    });

    it.each([
        ['2.2.2-rc.10', '2.2.2-rc.9', true],
        ['2.2.2-rc.2', '2.2.2-rc.9', false],
        ['2.2.2', '2.2.2-rc.9', true],
        ['2.2.3-1', '2.2.2-alpha', true],
        ['2.2.2-1', '2.2.2-alpha', false],
        ['2.2.2-alpha.1', '2.2.2-alpha', true],
        ['2.2.2-alpha', '2.2.2-alpha.1', false],
        ['2.2.2-beta', '2.2.2-alpha', true],
        ['2.2.2-alpha', '2.2.2-beta', false],
        ['2.2.2+build.9', '2.2.2', false],
        ['2.3.0', '2.2.2', true],
        ['2.2.3', '2.2.2', true],
        ['2.2.1', '2.2.2', false],
        ['2.2.2', '2.2.2', false],
        ['10.0.0', '9.9.9', true],
        ['9007199254740993.0.0', '9007199254740992.0.0', true],
    ])('compares %s against %s as newer=%s', async (tag, current, expected) => {
        await withPackageVersion(current, async (service) => {
            mocks.fetch.mockResolvedValue(releaseResponse(`v${tag}`));
            const result = await service.checkForUpdate(true);
            expect(result.available).toBe(expected);
            if (!expected) {
                expect(result).toEqual({ available: false });
            }
        });
    });

    it.each([
        // Numeric identifiers always rank below alphanumeric ones, whatever the text.
        ['1.0.0-alpha.beta', '1.0.0-alpha.1', true],
        ['1.0.0-alpha.1', '1.0.0-alpha.beta', false],
        ['1.0.0-1', '1.0.0-alpha', false],
        ['1.0.0-alpha', '1.0.0-1', true],
        // A longer identifier set wins only when every shared field is equal.
        ['1.0.0-alpha.1.2', '1.0.0-alpha.1', true],
        ['1.0.0-alpha.1', '1.0.0-alpha.1.2', false],
        // Zero is the lowest numeric identifier, and numerics rank below alphanumerics.
        ['1.0.0-0', '1.0.0-rc.1', false],
        ['1.0.0-rc.1', '1.0.0-0', true],
        ['1.0.0-alpha.0', '1.0.0-alpha', true],
        // A stable release outranks every prerelease of the same core version.
        ['1.0.0', '1.0.0-rc.1', true],
        ['1.0.0-rc.1', '1.0.0', false],
    ])('orders prerelease %s against %s as newer=%s', async (tag, current, expected) => {
        await withPackageVersion(current, async (service) => {
            mocks.fetch.mockResolvedValue(releaseResponse(`v${tag}`));
            expect((await service.checkForUpdate(true)).available).toBe(expected);
        });
    });

    it('never offers a release candidate to an installed stable build', async () => {
        await withPackageVersion('2.2.2', async (service) => {
            mocks.fetch.mockResolvedValue(releaseResponse('v2.3.0-rc.1'));
            await expect(service.checkForUpdate(true)).resolves.toEqual({ available: false });
        });
    });

    it('still rolls a release candidate forward for another release candidate', async () => {
        await withPackageVersion('2.3.0-rc.1', async (service) => {
            mocks.fetch.mockResolvedValue(releaseResponse('v2.3.0-rc.2'));
            await expect(service.checkForUpdate(true)).resolves.toMatchObject({ available: true, tag: 'v2.3.0-rc.2' });
        });
    });

    it('refuses to compare against an unreadable installed version', async () => {
        await withPackageVersion('not-a-version', async (service) => {
            mocks.fetch.mockResolvedValue(releaseResponse('v99.0.0'));
            await expect(service.checkForUpdate(true)).rejects.toThrow(/installed version/i);
        });
    });
});

describe('downloadAndInstallUpdate', () => {
    beforeEach(resetServiceMocks);

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('refuses to run outside the Android app', async () => {
        mocks.native = false;
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result).toMatchObject({ success: false });
        expect(result.error).toMatch(/Android/);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('refuses to run on a native platform without the Android installer', async () => {
        mocks.platform = 'ios';
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toMatch(/Android/);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('refuses to run when the bridge cannot name its platform', async () => {
        mocks.hasGetPlatform = false;
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toMatch(/Android/);
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses automatic installation without a verified digest', async () => {
        const result = await downloadAndInstallUpdate({ available: true, url: APK_URL, assetName: 'app.apk' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/SHA-256/);
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a digest that is not a sha256 hex string', async () => {
        const result = await downloadAndInstallUpdate(apkSource({ sha256: 'not-a-digest' }));
        expect(result.error).toMatch(/SHA-256/);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it.each([
        ['an empty digest', ''],
        ['a truncated digest', 'a'.repeat(63)],
        ['an over long digest', 'a'.repeat(65)],
        ['a non hex digest', 'z'.repeat(64)],
        ['a numeric digest', 1_234_567],
    ])('refuses %s', async (_label, sha256) => {
        const result = await downloadAndInstallUpdate(apkSource({ sha256 }));
        expect(result.success).toBe(false);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('accepts a prefixed or upper case digest in the update result', async () => {
        const bytes = apkBytes(64);
        const digest = await sha256(bytes);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(
            apkSource({ sha256: `SHA256:${digest.toUpperCase()}`, size: bytes.length }),
        );
        expect(result.success).toBe(true);
        expect(result.sha256).toBe(digest);
    });

    it.each([
        ['a non apk asset', { assetName: 'app.txt' }],
        ['a traversal asset name', { assetName: '../../update.apk' }],
        ['a hidden apk name', { assetName: '.apk' }],
        ['a mismatched asset name', { assetName: 'other.apk' }],
        ['an empty asset name', { assetName: '' }],
        ['an oversized asset name', { assetName: `${'a'.repeat(70)}.apk` }],
    ])('refuses %s before downloading', async (_label, overrides) => {
        const result = await downloadAndInstallUpdate(apkSource(overrides));
        expect(result.success).toBe(false);
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it.each([
        ['plaintext', 'http://github.com/sumon317/DailyStudyTracker/releases/download/v9/app.apk'],
        ['a foreign host', 'https://evil.example/app.apk'],
        ['another repository', 'https://github.com/attacker/DailyStudyTracker/releases/download/v9/app.apk'],
    ])('refuses %s download URLs', async (_label, url) => {
        const result = await downloadAndInstallUpdate(apkSource({ url }));
        expect(result.error).toMatch(/not an approved HTTPS GitHub URL/i);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it.each([
        ['null', null],
        ['a number', 7],
        ['a boolean', true],
        ['an array', [APK_URL]],
    ])('refuses %s as an update source without throwing a raw TypeError', async (_label, source) => {
        const result = await downloadAndInstallUpdate(
            source as unknown as Parameters<typeof downloadAndInstallUpdate>[0],
        );
        expect(result).toMatchObject({ success: false });
        expect(result.error).not.toMatch(/Cannot read/);
    });

    it('refuses an update result with no url at all', async () => {
        const result = await downloadAndInstallUpdate({
            available: true,
            assetName: 'app.apk',
            sha256: 'a'.repeat(64),
        });
        expect(result.error).toMatch(/not an approved HTTPS GitHub URL/i);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('refuses oversized metadata before downloading', async () => {
        const result = await downloadAndInstallUpdate(apkSource({ size: MAX_UPDATE_SIZE_BYTES + 1 }));
        expect(result.error).toMatch(/size limit/i);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it.each([
        ['a zero size', 0],
        ['a negative size', -1],
        ['a fractional size', 4.5],
        ['an unsafe integer size', 1e30],
        ['a string size', '4096'],
    ])('refuses %s from the update result before downloading', async (_label, size) => {
        const result = await downloadAndInstallUpdate(apkSource({ size }));
        expect(result.success).toBe(false);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('verifies, stores and installs a genuine APK', async () => {
        const bytes = apkBytes(2048);
        const digest = await sha256(bytes);
        const phases: string[] = [];
        const progress = vi.fn();
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));

        const result = await downloadAndInstallUpdate(apkSource({ sha256: digest, size: bytes.length }), {
            onProgress: progress,
            onPhase: (phase) => phases.push(phase),
        });

        expect(result).toEqual({ success: true, assetName: 'app.apk', sha256: digest, size: bytes.length });
        expect(phases).toEqual(['downloading', 'installing', 'success']);
        expect(progress).toHaveBeenLastCalledWith(100);
        const written = mocks.writeFile.mock.calls[0]?.[0] as { path: string; directory: string; data: string };
        expect(written.path).toBe('update.apk');
        expect(written.directory).toBe('CACHE');
        expect(fromBase64(written.data)).toEqual(bytes);
        expect(mocks.installApk).toHaveBeenCalledWith({ path: 'update.apk' });
    });

    /**
     * The published digest is the only thing that makes an install succeed, so this table is the
     * regression guard for the digest implementation itself. The lengths cover every boundary that
     * a streaming SHA-256 can get wrong: 55/56/57 (padding switches to a second block) and
     * 63/64/65/127/128/129 (whole 64-byte blocks), plus 1, 2 and 0 mod 3 so the base64 carry in
     * the bridge payload is exercised for all three remainders. Four bytes is the floor because a
     * body shorter than the ZIP magic can never be an APK.
     */
    it.each([4, 5, 6, 7, 8, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1000, 4096, 9001])(
        'round trips a %i byte APK through the digest check and base64',
        async (length) => {
            const bytes = apkBytes(length);
            const digest = await sha256(bytes);
            mocks.fetch.mockResolvedValue(octetStream(bytes));
            const result = await downloadAndInstallUpdate(apkSource({ sha256: digest, size: length }));
            expect(result).toEqual({ success: true, assetName: 'app.apk', sha256: digest, size: length });
            // A hasher that never folds in the padding block reports the SHA-256 initial state.
            expect(result.sha256).not.toBe(SHA256_INITIAL_STATE);
            const written = mocks.writeFile.mock.calls[0]?.[0] as { data: string };
            expect(fromBase64(written.data)).toEqual(bytes);
            expect(written.data).toBe(toBase64(bytes));
        },
    );

    it('produces the published digest for a body spanning many blocks', async () => {
        const bytes = apkBytes(64 * 1024 + 17);
        const digest = await sha256(bytes);
        mocks.fetch.mockResolvedValue(octetStream(bytes));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: digest, size: bytes.length }));
        expect(result.success).toBe(true);
        expect(result.sha256).toBe(digest);
        expect(await sha256(fromBase64(storedBase64()))).toBe(digest);
    });

    it('reassembles a body that arrives in awkward chunk sizes', async () => {
        const bytes = apkBytes(3001);
        const digest = await sha256(bytes);
        let offset = 0;
        const chunkSize = 7;
        const body = {
            getReader: () => ({
                read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
                    if (offset >= bytes.length) {
                        return Promise.resolve({ done: true });
                    }
                    const value = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
                    offset += chunkSize;
                    return Promise.resolve({ done: false, value });
                },
                cancel: vi.fn(),
            }),
        };
        mocks.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            url: '',
            headers: new Headers({ 'content-type': 'application/octet-stream' }),
            body,
        });

        const result = await downloadAndInstallUpdate(apkSource({ sha256: digest, size: bytes.length }));
        expect(result.success).toBe(true);
        const written = mocks.writeFile.mock.calls[0]?.[0] as { data: string };
        expect(fromBase64(written.data)).toEqual(bytes);
    });

    it('never reports progress beyond 99 before the digest is verified', async () => {
        const bytes = apkBytes(512);
        const progress = vi.fn();
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: undefined }), {
            onProgress: progress,
        });
        expect(result.success).toBe(true);
        for (const [value] of progress.mock.calls.slice(0, -1)) {
            expect(value).toBeLessThanOrEqual(99);
        }
        expect(progress).toHaveBeenLastCalledWith(100);
    });

    it('never reports progress backwards', async () => {
        const bytes = apkBytes(4096);
        const progress = vi.fn();
        let offset = 0;
        mocks.fetch.mockResolvedValue(
            lengthlessStream(() => {
                if (offset >= bytes.length) {
                    return Promise.resolve({ done: true });
                }
                const value = bytes.subarray(offset, Math.min(offset + 512, bytes.length));
                offset += 512;
                return Promise.resolve({ done: false, value });
            }),
        );
        await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }), {
            onProgress: progress,
        });
        const values = progress.mock.calls.map(([value]) => value as number);
        expect(values.length).toBeGreaterThan(1);
        for (let index = 1; index < values.length; index += 1) {
            expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] ?? 0);
        }
    });

    it('isolates a throwing progress callback instead of leaving the stream open', async () => {
        const bytes = apkBytes(512);
        const cancel = vi.fn(() => Promise.resolve());
        mocks.fetch.mockResolvedValue(lengthlessStream(() => Promise.resolve({ done: false, value: bytes }), cancel));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }), {
            onProgress: () => {
                throw new Error('rendering blew up');
            },
        });
        expect(result.success).toBe(false);
        expect(cancel).toHaveBeenCalled();
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('does not write or install bytes whose digest does not match', async () => {
        const bytes = apkBytes(64);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(
            apkSource({ sha256: await sha256(encode('other')), size: bytes.length }),
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/verification/i);
        expect(result.sha256).toBe(await sha256(bytes));
        expect(result.sha256).not.toBe(apkSource().sha256);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a body that does not start with the ZIP magic even when its digest matches', async () => {
        const bytes = encode('<!doctype html><h1>Not an APK</h1>');
        mocks.fetch.mockResolvedValue(
            new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
        );
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not an APK/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a body too short to even contain the ZIP magic', async () => {
        const bytes = apkBytes(3);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.error).toMatch(/not an APK/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a ZIP magic that appears at the wrong offset', async () => {
        const bytes = new Uint8Array(64);
        bytes.set(ZIP_MAGIC, 8);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.error).toMatch(/not an APK/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses an empty body even when the expected digest matches an empty payload', async () => {
        mocks.fetch.mockResolvedValue(
            new Response(new Uint8Array(0), { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
        );
        const result = await downloadAndInstallUpdate(
            apkSource({ sha256: await sha256(new Uint8Array(0)), size: undefined }),
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/empty/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a size that disagrees with GitHub metadata', async () => {
        const bytes = apkBytes(32);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': '32' }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: 64 }));
        expect(result.error).toMatch(/does not match GitHub metadata/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a truncated body even when the digest matches the truncated bytes', async () => {
        const bytes = apkBytes(300);
        mocks.fetch.mockResolvedValue(octetStream(bytes.subarray(0, 100)));
        const result = await downloadAndInstallUpdate(
            apkSource({ sha256: await sha256(bytes.subarray(0, 100)), size: 300 }),
        );
        expect(result.error).toMatch(/does not match GitHub metadata/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a body that ends early against its own declared content-length', async () => {
        const bytes = apkBytes(300);
        mocks.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            url: '',
            headers: new Headers({ 'content-type': 'application/octet-stream', 'content-length': '300' }),
            body: {
                getReader: () => ({
                    read: (): Promise<{ done: boolean; value?: Uint8Array }> =>
                        Promise.resolve({ done: false, value: bytes.subarray(0, 100) }),
                    cancel: vi.fn(),
                }),
            },
        });
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes.subarray(0, 100)) }));
        expect(result.error).toMatch(/does not match GitHub metadata/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('stops immediately when a stream keeps delivering past the published size', async () => {
        const bytes = apkBytes(48);
        const cancel = vi.fn(() => Promise.resolve());
        let reads = 0;
        mocks.fetch.mockResolvedValue(
            lengthlessStream(() => {
                reads += 1;
                // A hostile asset that never ends: only the size bound can stop it.
                return Promise.resolve(reads > 4 ? { done: true } : { done: false, value: bytes });
            }, cancel),
        );
        const result = await downloadAndInstallUpdate(apkSource({ sha256: 'a'.repeat(64), size: bytes.length }));
        expect(result.error).toMatch(/does not match GitHub metadata/i);
        expect(reads).toBe(2);
        expect(cancel).toHaveBeenCalled();
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it('refuses a declared content-length beyond the cap', async () => {
        mocks.fetch.mockResolvedValue(
            new Response(new Uint8Array(0), {
                status: 200,
                headers: {
                    'content-type': 'application/octet-stream',
                    'content-length': String(MAX_UPDATE_SIZE_BYTES + 1),
                },
            }),
        );
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toMatch(/size limit/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a declared content-length at exactly the cap plus one byte', async () => {
        mocks.fetch.mockResolvedValue(
            new Response(new Uint8Array(0), {
                status: 200,
                headers: {
                    'content-type': 'application/octet-stream',
                    'content-length': String(MAX_UPDATE_SIZE_BYTES + 1),
                },
            }),
        );
        await expect(downloadAndInstallUpdate(apkSource())).resolves.toMatchObject({
            error: expect.stringMatching(/size limit/i),
            size: MAX_UPDATE_SIZE_BYTES + 1,
        });
    });

    // Crossing the real 100 MB cap means hashing 100 MB in JavaScript, so this is the slowest
    // test in the file by design: it is the only way to prove the streaming bound is enforced
    // rather than merely trusted from a header.
    it('refuses a stream that grows past the cap without a declared length', { timeout: 120_000 }, async () => {
        const chunk = new Uint8Array(1024 * 1024);
        chunk.set(ZIP_MAGIC, 0);
        let sent = 0;
        mocks.fetch.mockResolvedValue(
            lengthlessStream(() => {
                sent += 1;
                return Promise.resolve(sent > 200 ? { done: true } : { done: false, value: chunk });
            }),
        );
        const result = await downloadAndInstallUpdate(apkSource({ size: undefined }));
        expect(result.error).toMatch(/size limit/i);
        expect(result.size).toBeGreaterThan(MAX_UPDATE_SIZE_BYTES);
        // Bytes are appended as they arrive, so the partial file exists for a moment. What matters
        // is that it cannot survive the refusal: it is deleted, and never named to the installer.
        expect(mocks.deleteFile).toHaveBeenCalledWith({ path: 'update.apk', directory: 'CACHE' });
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it.each([
        ['a non numeric content-length', 'abc'],
        ['a scientific content-length', '1e3'],
        ['a negative content-length', '-5'],
        ['a fractional content-length', '1.5'],
        ['a plus signed content-length', '+12'],
        ['a hex content-length', '0x10'],
        ['a grouped content-length', '1,024'],
        ['an infinite content-length', '1e400'],
        ['a non finite content-length', 'Infinity'],
        ['an internally spaced content-length', '1 2'],
        ['an empty content-length', ''],
    ])('refuses %s', async (_label, value) => {
        mocks.fetch.mockResolvedValue(
            new Response(new Uint8Array(0), {
                status: 200,
                headers: { 'content-type': 'application/octet-stream', 'content-length': value },
            }),
        );
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toMatch(/invalid size/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('reads a padded content-length after header whitespace is normalised', async () => {
        // `Headers` strips optional whitespace per the HTTP grammar, so " 12 " arrives as "12".
        // Treating it as invalid would be wrong; it is a real length and simply disagrees here.
        mocks.fetch.mockResolvedValue(
            new Response(new Uint8Array(0), {
                status: 200,
                headers: { 'content-type': 'application/octet-stream', 'content-length': ' 12 ' },
            }),
        );
        const result = await downloadAndInstallUpdate(apkSource({ size: 4 }));
        expect(result.error).toMatch(/does not match GitHub metadata/i);
        expect(result.size).toBe(12);
    });

    it('refuses an HTML or JSON error page served as an update', async () => {
        for (const contentType of ['text/html; charset=utf-8', 'application/json', 'text/plain']) {
            mocks.fetch.mockResolvedValue(
                new Response(encode('<html></html>'), { status: 200, headers: { 'content-type': contentType } }),
            );
            const result = await downloadAndInstallUpdate(apkSource());
            expect(result.error).toMatch(/not an APK/i);
        }
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a failed download and reports the status code', async () => {
        mocks.fetch.mockResolvedValue(new Response(null, { status: 502 }));
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.success).toBe(false);
        expect(result.error).toContain('502');
    });

    it.each([400, 401, 403, 404, 429, 500, 503])('does not leak internals for HTTP %i', async (status) => {
        mocks.fetch.mockResolvedValue(new Response(null, { status }));
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toContain(String(status));
        expect(result.error).not.toMatch(/github|atob|https/i);
    });

    it('refuses a download that redirects to an unapproved host', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            url: 'https://evil.example/app.apk',
            headers: new Headers({ 'content-type': 'application/octet-stream' }),
            body: null,
        });
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toMatch(/unapproved host/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('refuses a response whose body cannot be read', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            url: '',
            headers: new Headers({ 'content-type': 'application/octet-stream' }),
            body: null,
        });
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toMatch(/cannot be read safely/i);
    });

    it('gives up on a stream that only ever yields empty chunks', async () => {
        let reads = 0;
        mocks.fetch.mockResolvedValue(
            lengthlessStream(() => {
                reads += 1;
                return Promise.resolve({ done: false, value: new Uint8Array(0) });
            }),
        );
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.success).toBe(false);
        expect(reads).toBeLessThan(200);
    });

    it.each([
        ['a cancel that returns nothing', () => undefined],
        [
            'a cancel that throws synchronously',
            () => {
                throw new Error('already released');
            },
        ],
        ['a cancel that rejects', () => Promise.reject(new Error('stream already closed'))],
    ])('survives %s when abandoning a download', async (_label, cancel) => {
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(lengthlessStream(() => Promise.resolve({ done: false, value: bytes }), cancel));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: 'b'.repeat(64), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('keeps a progressing download alive far beyond the response timeout', async () => {
        const chunk = apkBytes(4);
        const chunks = 8;
        let reads = 0;
        let signal: AbortSignal | undefined;
        let release: (() => void) | undefined;
        const body = {
            getReader: () => ({
                read: (): Promise<{ done: boolean; value?: Uint8Array }> =>
                    new Promise((resolve, reject) => {
                        signal?.addEventListener('abort', () => {
                            reject(new DOMException('The operation was aborted.', 'AbortError'));
                        });
                        release = () => {
                            reads += 1;
                            resolve(reads > chunks ? { done: true } : { done: false, value: chunk });
                        };
                    }),
                cancel: vi.fn(),
            }),
        };
        const payload = new Uint8Array(chunk.length * chunks);
        for (let index = 0; index < chunks; index += 1) {
            payload.set(chunk, index * chunk.length);
        }
        const digest = await sha256(payload);
        mocks.fetch.mockImplementation((_url: string, init: RequestInit) => {
            signal = init.signal ?? undefined;
            return Promise.resolve({
                ok: true,
                status: 200,
                url: 'https://release-assets.githubusercontent.com/github-production-release-asset/uuid',
                headers: new Headers({
                    'content-length': String(payload.length),
                    'content-type': 'application/octet-stream',
                }),
                body,
            });
        });

        vi.useFakeTimers();
        try {
            const pending = downloadAndInstallUpdate(apkSource({ sha256: digest, size: payload.length }));
            // Deliver one 4-byte chunk per 25 virtual seconds: 200s in total, which is far
            // beyond the 30s response budget yet never stalls for the 120s stall budget.
            await vi.advanceTimersByTimeAsync(0);
            for (let step = 0; step < chunks + 3 && release; step += 1) {
                await vi.advanceTimersByTimeAsync(25_000);
                const next = release;
                release = undefined;
                next?.();
                await vi.advanceTimersByTimeAsync(0);
            }
            const result = await pending;
            expect(result.success).toBe(true);
            expect(result.size).toBe(payload.length);
            expect(mocks.installApk).toHaveBeenCalledWith({ path: 'update.apk' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('aborts a download that stalls past the stall timeout', async () => {
        let signal: AbortSignal | undefined;
        mocks.fetch.mockImplementation((_url: string, init: RequestInit) => {
            signal = init.signal ?? undefined;
            return Promise.resolve({
                ok: true,
                status: 200,
                url: '',
                headers: new Headers({ 'content-type': 'application/octet-stream' }),
                body: {
                    getReader: () => ({
                        read: (): Promise<{ done: boolean; value?: Uint8Array }> =>
                            new Promise((_resolve, reject) => {
                                signal?.addEventListener('abort', () => {
                                    reject(new DOMException('The operation was aborted.', 'AbortError'));
                                });
                            }),
                        cancel: vi.fn(),
                    }),
                },
            });
        });

        const pending = downloadAndInstallUpdate(apkSource());
        vi.useFakeTimers();
        try {
            await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + 1_000);
        } finally {
            vi.useRealTimers();
        }
        const result = await pending;
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/timed out/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('still bounds the download when the runtime has no AbortController', async () => {
        vi.stubGlobal('AbortController', undefined);
        mocks.fetch.mockResolvedValue(
            lengthlessStream(() => new Promise<{ done: boolean; value?: Uint8Array }>(() => undefined)),
        );
        // Fake timers must be installed first: the deadline is armed synchronously, so a real
        // timer here would leave the test hanging instead of exercising the bound.
        vi.useFakeTimers();
        let pending: Promise<{ success: boolean; error?: string }>;
        try {
            pending = downloadAndInstallUpdate(apkSource());
            await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + 1_000);
        } finally {
            vi.useRealTimers();
        }
        await expect(pending).resolves.toMatchObject({ success: false, error: expect.stringMatching(/timed out/i) });
    });

    it('still completes normally when the runtime has no AbortController', async () => {
        const bytes = apkBytes(128);
        const digest = await sha256(bytes);
        vi.stubGlobal('AbortController', undefined);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: digest, size: bytes.length }));
        expect(result.success).toBe(true);
        expect(mocks.installApk).toHaveBeenCalledWith({ path: 'update.apk' });
    });

    it('bounds a native installer that never answers', async () => {
        const bytes = apkBytes(64);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.installApk.mockImplementation(() => new Promise(() => undefined));

        const pending = downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        vi.useFakeTimers();
        try {
            await vi.advanceTimersByTimeAsync(INSTALL_TIMEOUT_MS + 1_000);
        } finally {
            vi.useRealTimers();
        }
        const result = await pending;
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/timed out/i);
    });

    it('reports an aborted download without leaking the transport error', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            url: '',
            headers: new Headers({ 'content-type': 'application/octet-stream' }),
            body: {
                getReader: () => ({
                    read: () => Promise.reject(new DOMException('Aborted', 'AbortError')),
                    cancel: vi.fn(),
                }),
            },
        });
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toMatch(/interrupted/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('hides a raw transport error behind a generic failure', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            url: '',
            headers: new Headers({ 'content-type': 'application/octet-stream' }),
            body: {
                getReader: () => ({
                    read: () => Promise.reject(new TypeError('Failed to fetch: https://github.com/secret/path')),
                    cancel: vi.fn(),
                }),
            },
        });
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toBe('The update could not be completed.');
        expect(result.error).not.toMatch(/github|secret/i);
    });

    it.each([
        ['undefined', undefined],
        ['an empty object', {}],
        ['canRequestPackages only', { canRequestPackages: true }],
        ['granted false', { granted: false }],
        ['granted as a string', { granted: 'true' }],
        ['granted as a number', { granted: 1 }],
        ['a bare boolean true', true],
        ['a bare boolean false', false],
        ['a boxed boolean', Object(true) as unknown],
        ['a string', 'granted'],
        ['an array', [{ granted: true }]],
    ])('refuses to install when the install-permission probe returns %s', async (_label, response) => {
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.checkInstallPermission.mockResolvedValue(response);

        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/permission/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it.each([
        ['an explicit grant', { granted: true }],
        ['a grant beside other fields', { granted: true, canRequestPackages: false }],
    ])('installs when the install-permission probe returns %s', async (_label, response) => {
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.checkInstallPermission.mockResolvedValue(response);

        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(true);
        expect(mocks.installApk).toHaveBeenCalledWith({ path: 'update.apk' });
    });

    /**
     * The dialog gates "Update Now" on `isInstallPermissionGranted` before it ever calls this
     * service, so the two predicates must agree exactly. A disagreement is a case where the UI
     * enables an install the service then refuses, or worse, the reverse.
     */
    it.each([
        [{ granted: true }],
        [{ granted: true, canRequestPackages: false }],
        [{ granted: false }],
        [{ canRequestPackages: true }],
        [{ granted: 'true' }],
        [{}],
        [true],
        [false],
        [undefined],
        [null],
        ['granted'],
        [[{ granted: true }]],
    ])('agrees with the shipped permission predicate for %j', async (response) => {
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.checkInstallPermission.mockResolvedValue(response);

        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(isInstallPermissionGranted(response));
    });

    it('does not leak filesystem or bridge internals into the failure message', async () => {
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.writeFile.mockRejectedValue(
            new Error('EACCES: permission denied, open /data/user/0/com.sumon.studytracker/files/update.apk'),
        );
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(result.error).not.toContain('/data/user/0');
        expect(result.error).not.toContain('EACCES');
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('hides a native installer failure behind a generic message', async () => {
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.installApk.mockRejectedValue(
            new Error('java.lang.SecurityException: com.example.foo is not allowed to request installs'),
        );
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.error).toBe('The update could not be completed.');
        expect(result.error).not.toMatch(/SecurityException|com\.example/);
    });

    it('never reports a digest it has not verified', async () => {
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.installApk.mockRejectedValue(new Error('Unable to install APK'));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(result.sha256).toBe(await sha256(bytes));
    });

    it('never reports progress to 100 when the install fails', async () => {
        const bytes = apkBytes(48);
        const progress = vi.fn();
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.installApk.mockRejectedValue(new Error('Unable to install APK'));
        const phases: string[] = [];
        await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }), {
            onProgress: progress,
            onPhase: (phase) => phases.push(phase),
        });
        expect(phases).not.toContain('success');
    });

    it.each([
        ['a missing result', undefined],
        ['a numeric uri', { uri: 42 }],
        ['a null result', null],
        ['a string result', 'file:///cache/update.apk'],
        ['an array result', []],
    ])('fails loudly when storing the verified APK returns %s', async (_label, written) => {
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.writeFile.mockResolvedValue(written);
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('accepts a stored result that omits the uri the bridge does not always return', async () => {
        // The native side resolves the APK by path, so a bridge version that returns no `uri` is
        // tolerated; only a `uri` of the wrong type is treated as a failed write.
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        mocks.writeFile.mockResolvedValue({});
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(true);
        expect(mocks.installApk).toHaveBeenCalledWith({ path: 'update.apk' });
    });

    it('cancels the response body when it abandons the download', async () => {
        const cancel = vi.fn(() => Promise.resolve());
        const bytes = apkBytes(48);
        mocks.fetch.mockResolvedValue(lengthlessStream(() => Promise.resolve({ done: false, value: bytes }), cancel));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: 'b'.repeat(64), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(cancel).toHaveBeenCalled();
    });

    it('releases an unread response body instead of pinning the connection', async () => {
        const cancel = vi.fn(() => Promise.resolve());
        mocks.fetch.mockResolvedValue({
            ok: false,
            status: 502,
            url: '',
            headers: new Headers(),
            body: { cancel },
        });
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toContain('502');
        expect(cancel).toHaveBeenCalled();
    });

    it('releases a response body that was redirected to an unapproved host', async () => {
        const cancel = vi.fn(() => Promise.resolve());
        mocks.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            url: 'https://evil.example/app.apk',
            headers: new Headers(),
            body: { cancel },
        });
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toMatch(/unapproved host/i);
        expect(cancel).toHaveBeenCalled();
    });

    it.each([
        ['a numeric url', { url: 42 }],
        ['a null url', { url: null }],
        ['a numeric asset name', { assetName: 42 }],
        ['a numeric digest', { sha256: 42 }],
        ['a digest object', { sha256: { value: 'a'.repeat(64) } }],
        ['a string size', { size: '4096' }],
        ['a null size', { size: null }],
        ['a boolean size', { size: true }],
    ])('refuses a source whose %s is supplied with the wrong type', async (_label, override) => {
        // Dropping a supplied-but-unusable field would silently drop the constraint it carried, so
        // the whole result is refused before anything is fetched.
        const result = await downloadAndInstallUpdate(apkSource(override));
        expect(result.success).toBe(false);
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('treats an explicitly absent field as "not reported" rather than as malformed', async () => {
        const bytes = apkBytes(128);
        const digest = await sha256(bytes);
        mocks.fetch.mockResolvedValue(octetStream(bytes));
        // `size: undefined` is how a caller spells "GitHub published no size"; the download must
        // still proceed under the streaming cap rather than be refused as malformed.
        const result = await downloadAndInstallUpdate(
            apkSource({ size: undefined, url: APK_URL, assetName: undefined, sha256: digest }),
        );
        expect(result.success).toBe(true);
        expect(result.size).toBe(bytes.length);
    });

    it('leaves no timer running once an install finishes', async () => {
        const bytes = apkBytes(256);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        vi.useFakeTimers();
        let result: Awaited<ReturnType<typeof downloadAndInstallUpdate>>;
        try {
            const pending = downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
            await vi.advanceTimersByTimeAsync(0);
            result = await pending;
            expect(result.success).toBe(true);
            // The stall/abort timer is disarmed before the install and cleared in the finally block;
            // a leaked one would fire minutes later and abort an unrelated request.
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('accepts the legacy positional download arguments', async () => {
        const bytes = apkBytes(24);
        const digest = await sha256(bytes);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(APK_URL, () => undefined, digest, bytes.length, 'app.apk');
        expect(result.success).toBe(true);
        expect(mocks.installApk).toHaveBeenCalledWith({ path: 'update.apk' });
    });

    it('refuses the legacy positional form when its digest slot is unusable', async () => {
        const bytes = apkBytes(24);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(
            APK_URL,
            () => undefined,
            'not-a-digest',
            bytes.length,
            'app.apk',
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/SHA-256/);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('treats a non object second argument as no options at all', async () => {
        const result = await downloadAndInstallUpdate(
            apkSource(),
            'nonsense' as unknown as Parameters<typeof downloadAndInstallUpdate>[1],
        );
        expect(result.success).toBe(false);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('accepts a bare URL source but never installs it unverified', async () => {
        const result = await downloadAndInstallUpdate(APK_URL);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/SHA-256/);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('keeps the verified payload readable as the exact APK bytes', async () => {
        const bytes = apkBytes(9_001, 13);
        const digest = await sha256(bytes);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: digest, size: bytes.length }));
        expect(result.success).toBe(true);
        const stored = fromBase64(storedBase64());
        expect(stored.length).toBe(bytes.length);
        await expect(sha256(stored)).resolves.toBe(digest);
        expect(decode(stored.subarray(4, 12))).toBe(decode(bytes.subarray(4, 12)));
    });
});

/**
 * A 100 MB APK has to reach the native side as base64, which is four thirds of the payload, and a
 * single `writeFile` of that size materialises the string here, again when the bridge serialises
 * it to JSON, and again as the Java `String` the plugin decodes. The service therefore streams the
 * body to disk in bounded chunks. These tests pin the properties that make that safe and cheap:
 * the chunks reassemble into exactly the downloaded bytes, no single call carries a whole-APK
 * string, and nothing that fails verification is left behind.
 */
describe('downloadAndInstallUpdate: chunked APK storage', () => {
    /**
     * Must match `BASE64_WRITE_CHUNK_CHARS` in the service. Hard-coding it here is the point: a
     * silent change to that constant is exactly the kind of edit these tests exist to catch,
     * because the chunk bound is what keeps the transfer inside a device's heap.
     */
    const CHUNK_CHARS = 256 * 1024;
    /**
     * Just over the 192 KiB of raw bytes that fill the first base64 chunk, so the payload takes
     * two bridge calls with a padded remainder. Kept as small as the property allows: every case
     * here re-hashes and re-encodes the whole payload in JavaScript, and the suite runs its files
     * in parallel.
     */
    const OVERSIZED_LENGTH = 256 * 1024;

    beforeEach(resetServiceMocks);

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('reassembles a multi-chunk APK into exactly the downloaded bytes', { timeout: 30_000 }, async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 29);
        const digest = await sha256(bytes);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: digest, size: bytes.length }));
        expect(result).toEqual({ success: true, assetName: 'app.apk', sha256: digest, size: bytes.length });
        expect(writeCallCount()).toBeGreaterThan(1);
        expect(fromBase64(storedBase64())).toEqual(bytes);
        expect(mocks.installApk).toHaveBeenCalledWith({ path: 'update.apk' });
    });

    it('never hands a whole-APK string to a single bridge call', { timeout: 30_000 }, async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 31);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        const chunks = storedChunks();
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(CHUNK_CHARS);
        }
        // The payload is four thirds of the asset, so the old single-call write would have been
        // ~700 KB. Staying under the bound is what bounds the peak.
        expect(storedBase64().length).toBe(Math.ceil(bytes.length / 3) * 4);
        expect(chunks.some((chunk) => chunk.length > CHUNK_CHARS)).toBe(false);
    });

    it('writes once and only ever appends afterwards', async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 37);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        // `writeFile` truncates, so a second one would be the only way to start the file over.
        expect(mocks.writeFile).toHaveBeenCalledTimes(1);
        expect(mocks.appendFile.mock.calls.length).toBe(writeCallCount() - 1);
        for (const call of [...mocks.appendFile.mock.calls]) {
            expect((call[0] as WriteCall).path).toBe('update.apk');
            expect((call[0] as WriteCall).directory).toBe('CACHE');
        }
    });

    it('pads only the final chunk, so no chunk boundary splits a base64 group', async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 41);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        const chunks = storedChunks();
        const padded = chunks.map((chunk) => chunk.includes('='));
        // A padded chunk followed by more data is not valid base64, and the plugin would refuse
        // the whole file. Every chunk but the last must therefore be padding free.
        expect(padded.slice(0, -1)).toEqual(padded.slice(0, -1).map(() => false));
        expect(padded[padded.length - 1]).toBe(true);
    });

    it('removes the partial APK when the digest does not match', { timeout: 30_000 }, async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 43);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(
            apkSource({ sha256: await sha256(encode('other')), size: bytes.length }),
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/verification/i);
        // A refused transfer stops before the padded remainder, so the file is left holding only
        // the flushed chunk. That it exists at all is the point: the bytes were on disk and still
        // had to go.
        expect(writeCallCount()).toBeGreaterThanOrEqual(1);
        expect(mocks.deleteFile).toHaveBeenCalledWith({ path: 'update.apk', directory: 'CACHE' });
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('removes the partial APK when the body is not an APK at all', { timeout: 30_000 }, async () => {
        // Long enough to be appended, and served as octets so the content-type guard does not
        // catch it first: the ZIP magic check is what has to reject this one.
        const bytes = new Uint8Array(OVERSIZED_LENGTH + 5);
        bytes.fill(0x41);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not an APK/i);
        expect(writeCallCount()).toBeGreaterThanOrEqual(1);
        expect(mocks.deleteFile).toHaveBeenCalledWith({ path: 'update.apk', directory: 'CACHE' });
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('keeps the verified APK when only the install permission is missing', async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 53);
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/permission/i);
        // The dialog retries the moment the grant comes back. Deleting a verified 100 MB APK to
        // make the user download it again would be the worse failure.
        expect(mocks.deleteFile).not.toHaveBeenCalled();
    });

    it('keeps the verified APK when the installer itself fails', async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 59);
        mocks.installApk.mockRejectedValue(new Error('Unable to install APK'));
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(mocks.deleteFile).not.toHaveBeenCalled();
    });

    it('never deletes the verified APK after a successful install', async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 61);
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(true);
        expect(mocks.deleteFile).not.toHaveBeenCalled();
    });

    it('deletes the partial APK when an append fails midway', async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 67);
        mocks.appendFile.mockRejectedValue(new Error('EACCES: permission denied'));
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(false);
        expect(result.error).not.toMatch(/EACCES|permission denied/);
        expect(mocks.deleteFile).toHaveBeenCalledWith({ path: 'update.apk', directory: 'CACHE' });
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('survives a delete that fails or is refused by the bridge', async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 71);
        mocks.deleteFile.mockRejectedValue(new Error('ENOENT: no such file'));
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(
            apkSource({ sha256: await sha256(encode('other')), size: bytes.length }),
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/verification/i);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('never writes to the filesystem for a body that is refused before the stream opens', async () => {
        mocks.fetch.mockResolvedValue(
            new Response(encode('<html></html>'), {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
        );
        const result = await downloadAndInstallUpdate(apkSource());
        expect(result.error).toMatch(/not an APK/i);
        expect(writeCallCount()).toBe(0);
        // Nothing was ever written, so there is nothing to remove; deleting a file that was never
        // created would be a bridge call that can only fail.
        expect(mocks.deleteFile).not.toHaveBeenCalled();
    });

    it('surfaces a failed write without leaking the bridge error', async () => {
        const bytes = apkBytes(OVERSIZED_LENGTH, 73);
        mocks.writeFile.mockRejectedValue(new Error('java.io.IOException: /data/user/0/com.sumon.studytracker/cache'));
        mocks.fetch.mockResolvedValue(octetStream(bytes, { 'content-length': String(bytes.length) }));
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.error).toBe('The update could not be completed.');
        expect(result.error).not.toMatch(/IOException|\/data\/user/);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });
});

/**
 * With an `AbortController` the stall timer cancels the request itself, so a timed-out transfer
 * stops on its own. Without one there is nothing to cancel: the deadline releases the caller while
 * the transfer keeps running. These tests pin that the abandoned transfer is inert, because the
 * previous behaviour wrote to the filesystem and eventually launched the installer long after the
 * caller had been told the update failed.
 */
describe('downloadAndInstallUpdate: abandoned transfers', () => {
    const CHUNK_SIZE = 32 * 1024;
    const CHUNKS = 10;
    /** Comfortably more than one base64 chunk, so the flushed path is exercised. */
    const OVERSIZED_LENGTH_FOR_ABANDON = 256 * 1024;

    beforeEach(resetServiceMocks);

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    /**
     * A body whose reads are only released by the test, so the virtual clock can be moved past a
     * deadline while the transfer is mid-stream.
     */
    const gatedStream = (bytes: Bytes) => {
        let offset = 0;
        let release: (() => void) | undefined;
        const next = (): { done: boolean; value?: Bytes } => {
            if (offset >= bytes.length) {
                return { done: true };
            }
            const value = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
            offset += CHUNK_SIZE;
            return { done: false, value };
        };
        return {
            get pending(): (() => void) | undefined {
                return release;
            },
            release(): void {
                const resume = release;
                release = undefined;
                resume?.();
            },
            response: {
                ok: true,
                status: 200,
                url: '',
                headers: new Headers({ 'content-type': 'application/octet-stream' }),
                body: {
                    getReader: () => ({
                        read: (): Promise<{ done: boolean; value?: Bytes }> =>
                            new Promise((resolve) => {
                                release = () => resolve(next());
                            }),
                        cancel: vi.fn(),
                    }),
                },
            },
        };
    };

    /**
     * Delivers `count` chunks, advancing 5 virtual seconds between each one.
     *
     * Five seconds keeps seven chunks (35s) comfortably inside the 120s the no-controller path
     * allows for the whole transfer, so the deadline can be tripped deliberately afterwards rather
     * than arriving early and cutting the transfer short.
     */
    const deliver = async (stream: ReturnType<typeof gatedStream>, count: number): Promise<void> => {
        for (let step = 0; step < count && stream.pending; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
            stream.release();
            await vi.advanceTimersByTimeAsync(0);
        }
    };

    it('stops writing and installing once the no-controller deadline has released the caller', async () => {
        vi.stubGlobal('AbortController', undefined);
        const bytes = apkBytes(CHUNK_SIZE * CHUNKS, 79);
        const digest = await sha256(bytes);
        const stream = gatedStream(bytes);
        mocks.fetch.mockResolvedValue(stream.response);

        vi.useFakeTimers();
        let result: Awaited<ReturnType<typeof downloadAndInstallUpdate>>;
        try {
            const pending = downloadAndInstallUpdate(apkSource({ sha256: digest, size: bytes.length }));
            await vi.advanceTimersByTimeAsync(0);
            // Six chunks are 192 KiB, which is exactly the first full base64 chunk, so the file has
            // been created on disk by the time the deadline is allowed to fire.
            await deliver(stream, 7);
            await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + 1_000);
            result = await pending;
        } finally {
            vi.useRealTimers();
        }
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/timed out/i);
        const writesAtTimeout = writeCallCount();
        expect(writesAtTimeout).toBeGreaterThan(0);

        // Let the abandoned transfer run the rest of the way to the end of the body.
        vi.useFakeTimers();
        try {
            await deliver(stream, CHUNKS + 2);
            await vi.advanceTimersByTimeAsync(0);
        } finally {
            vi.useRealTimers();
        }
        // The bytes that arrived after the deadline are dropped rather than appended...
        expect(writeCallCount()).toBe(writesAtTimeout);
        // ...the partial file is cleaned up...
        expect(mocks.deleteFile).toHaveBeenCalledWith({ path: 'update.apk', directory: 'CACHE' });
        // ...and no second installer launch happens behind the caller's back.
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('does not touch the filesystem when the deadline fires before the first chunk lands', async () => {
        vi.stubGlobal('AbortController', undefined);
        const bytes = apkBytes(CHUNK_SIZE * CHUNKS, 83);
        const stream = gatedStream(bytes);
        mocks.fetch.mockResolvedValue(stream.response);

        vi.useFakeTimers();
        let result: Awaited<ReturnType<typeof downloadAndInstallUpdate>>;
        try {
            const pending = downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
            await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + 1_000);
            result = await pending;
            await deliver(stream, CHUNKS);
            await vi.advanceTimersByTimeAsync(0);
        } finally {
            vi.useRealTimers();
        }
        expect(result.error).toMatch(/timed out/i);
        expect(writeCallCount()).toBe(0);
        expect(mocks.installApk).not.toHaveBeenCalled();
    });

    it('still finishes normally on a runtime that has no AbortController', { timeout: 30_000 }, async () => {
        vi.stubGlobal('AbortController', undefined);
        const bytes = apkBytes(OVERSIZED_LENGTH_FOR_ABANDON, 89);
        // A synthetic reader rather than a real `Response`: the WHATWG stream plumbing behind a
        // constructed `Response` reaches for `AbortController` itself, so stubbing the global away
        // would stall the fixture instead of exercising the service.
        let offset = 0;
        mocks.fetch.mockResolvedValue(
            lengthlessStream(() => {
                if (offset >= bytes.length) {
                    return Promise.resolve({ done: true });
                }
                const value = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
                offset += CHUNK_SIZE;
                return Promise.resolve({ done: false, value });
            }),
        );
        const result = await downloadAndInstallUpdate(apkSource({ sha256: await sha256(bytes), size: bytes.length }));
        expect(result.success).toBe(true);
        expect(writeCallCount()).toBeGreaterThan(1);
        expect(fromBase64(storedBase64())).toEqual(bytes);
        expect(mocks.installApk).toHaveBeenCalledWith({ path: 'update.apk' });
    });
});
