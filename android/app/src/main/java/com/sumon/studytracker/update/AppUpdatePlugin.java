package com.sumon.studytracker.update;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "NativeAppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String FILE_PROVIDER_SUFFIX = ".fileprovider";
    private static final String DEFAULT_CACHE_FILE_NAME = "update.apk";

    static final long MAX_UPDATE_SIZE_BYTES = 100L * 1024L * 1024L;
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 120_000;
    private static final int MAX_REDIRECTS = 5;
    private static final int STREAM_BUFFER_BYTES = 64 * 1024;
    private static final byte[] APK_ZIP_MAGIC = new byte[] { 0x50, 0x4b, 0x03, 0x04 };

    private static final String GITHUB_HOST = "github.com";
    private static final String GITHUB_RELEASE_PATH_PREFIX = "/sumon317/DailyStudyTracker/releases/";
    private static final String RELEASE_ASSETS_HOST = "release-assets.githubusercontent.com";
    private static final String OBJECTS_ASSETS_HOST = "objects.githubusercontent.com";
    private static final String ASSET_PATH_PREFIX = "/github-production-release-asset/";
    private static final String ASSET_BUCKET_PATH_PREFIX = "/github-production-release-asset-";

    /**
     * Forwarded to the web layer, so it must stay free of the resolved path and the provider
     * authority. A named constant rather than a literal at each throw site, because a package
     * can fail to parse in two different ways and the two copies of a user-facing string are
     * exactly the kind that drift.
     */
    static final String UNREADABLE_PACKAGE_MESSAGE = "APK could not be read as an Android package";

    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "AppUpdateDownload");
        thread.setDaemon(true);
        return thread;
    });

    @PluginMethod
    public void checkInstallPermission(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Application context unavailable");
            return;
        }

        boolean granted;
        try {
            granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                    || context.getPackageManager().canRequestPackageInstalls();
        } catch (Exception exception) {
            call.reject("Unable to check install permission");
            return;
        }
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Application context unavailable");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }

        Intent settingsIntent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.getPackageName())
        );
        try {
            launch(context, settingsIntent);
            call.resolve();
        } catch (RuntimeException exception) {
            // Some OEM builds ship the per-app screen without the package extra, so fall back
            // to the app details page, which always links to it.
            Intent detailsIntent = new Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + context.getPackageName())
            );
            try {
                launch(context, detailsIntent);
                call.resolve();
            } catch (RuntimeException fallbackException) {
                call.reject("Install permission settings are unavailable");
            }
        }
    }

    @PluginMethod
    public void downloadApk(PluginCall call) {
        final Context context = getContext();
        if (context == null) {
            call.reject("Application context unavailable");
            return;
        }

        final String url = call.getString("url");
        final String expectedSha256 = normalizeSha256(call.getString("sha256"));
        final String requestedPath = call.getString("path");
        final String cachePath = (requestedPath == null || requestedPath.trim().isEmpty())
                ? DEFAULT_CACHE_FILE_NAME
                : requestedPath;
        final Long expectedSize;
        try {
            expectedSize = readOptionalExpectedSize(call);
        } catch (RejectedInstallException exception) {
            call.reject(String.valueOf(exception.getMessage()));
            return;
        }

        if (!isAllowedReleaseDownloadUrl(url)) {
            call.reject("The update URL is not an approved HTTPS GitHub URL.");
            return;
        }
        if (expectedSha256 == null) {
            call.reject("A GitHub SHA-256 digest is required for automatic installation. Use manual browser installation instead.");
            return;
        }
        if (expectedSize != null && (expectedSize <= 0L || expectedSize > MAX_UPDATE_SIZE_BYTES)) {
            call.reject("The update exceeds the safe download size limit.");
            return;
        }

        final File targetFile;
        try {
            targetFile = resolveCacheTarget(context, cachePath);
        } catch (RejectedInstallException exception) {
            call.reject(String.valueOf(exception.getMessage()));
            return;
        } catch (IOException exception) {
            call.reject("The update could not be completed.");
            return;
        }

        downloadExecutor.execute(() -> {
            try {
                DownloadOutcome outcome = performDownload(url, expectedSha256, expectedSize, targetFile);
                JSObject result = new JSObject();
                result.put("path", cachePath);
                result.put("sha256", outcome.sha256);
                result.put("size", outcome.size);
                call.resolve(result);
            } catch (RejectedInstallException exception) {
                call.reject(String.valueOf(exception.getMessage()));
            } catch (SocketTimeoutException exception) {
                call.reject("The update timed out. Check your connection and try again.");
            } catch (Exception exception) {
                call.reject("The update could not be completed.");
            }
        });
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Application context unavailable");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !context.getPackageManager().canRequestPackageInstalls()) {
                call.reject("Install permission is not granted");
                return;
            }
            File apkFile = resolveCacheFile(context, call.getString("path"));
            validatePackageArchive(context, apkFile);
            Uri contentUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + FILE_PROVIDER_SUFFIX,
                    apkFile
            );
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            // CATEGORY_DEFAULT is what the package installer filters on; the system also adds
            // it for startActivity(), but relying on that is how OEM resolvers occasionally
            // fail to find an installer.
            installIntent.addCategory(Intent.CATEGORY_DEFAULT);
            installIntent.setDataAndType(contentUri, APK_MIME_TYPE);
            // A content-uri grant needs both a data uri and a ClipData so the read permission
            // reaches the installer process rather than only the activity that resolves it.
            installIntent.setClipData(ClipData.newRawUri("apk", contentUri));
            installIntent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK
            );
            launch(context, installIntent);
            call.resolve();
        } catch (RejectedInstallException exception) {
            // Messages from the plugin's own checks are written for the UI and are safe to
            // forward. Everything else (FileProvider, Uri parsing) embeds the resolved
            // absolute path and the provider authority, so those stay generic.
            call.reject(String.valueOf(exception.getMessage()));
        } catch (ActivityNotFoundException exception) {
            call.reject("No application can install this package");
        } catch (IllegalArgumentException exception) {
            call.reject("APK path is not usable");
        } catch (Exception exception) {
            call.reject("Unable to install APK");
        }
    }

    private static Long readOptionalExpectedSize(PluginCall call) throws RejectedInstallException {
        if (call == null || call.getData() == null || !call.getData().has("size") || call.getData().isNull("size")) {
            return null;
        }
        Object raw = call.getData().opt("size");
        if (raw instanceof Integer || raw instanceof Long) {
            long value = ((Number) raw).longValue();
            if (value <= 0L) {
                throw new RejectedInstallException("The update exceeds the safe download size limit.");
            }
            return value;
        }
        if (raw instanceof Number) {
            double number = ((Number) raw).doubleValue();
            if (!Double.isFinite(number) || number != Math.floor(number) || number <= 0d || number > 9007199254740991d) {
                throw new RejectedInstallException("The update exceeds the safe download size limit.");
            }
            return (long) number;
        }
        throw new RejectedInstallException("The update exceeds the safe download size limit.");
    }

    private DownloadOutcome performDownload(
            String initialUrl,
            String expectedSha256,
            Long expectedSize,
            File targetFile
    ) throws Exception {
        String currentUrl = initialUrl;
        HttpsURLConnection connection = null;
        boolean completeOnDisk = false;
        boolean storeStarted = false;

        try {
            for (int redirectCount = 0; ; redirectCount++) {
                if (!isAllowedReleaseDownloadUrl(currentUrl)) {
                    throw new RejectedInstallException("The update redirected to an unapproved host.");
                }
                URL parsedUrl = new URL(currentUrl);
                HttpURLConnection rawConnection = (HttpURLConnection) parsedUrl.openConnection();
                if (!(rawConnection instanceof HttpsURLConnection)) {
                    rawConnection.disconnect();
                    throw new RejectedInstallException("The update redirected to an unapproved host.");
                }
                connection = (HttpsURLConnection) rawConnection;
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setUseCaches(false);
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Accept", "application/octet-stream");
                connection.setRequestProperty("Cache-Control", "no-store");
                connection.setRequestProperty("User-Agent", "DailyStudyTracker-Android");

                int status = connection.getResponseCode();
                if (isRedirectStatus(status)) {
                    if (redirectCount >= MAX_REDIRECTS) {
                        throw new RejectedInstallException("The update redirected to an unapproved host.");
                    }
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    connection = null;
                    if (location == null || location.trim().isEmpty()) {
                        throw new RejectedInstallException("The update redirected to an unapproved host.");
                    }
                    String resolvedLocation;
                    try {
                        resolvedLocation = URI.create(currentUrl).resolve(location.trim()).toString();
                    } catch (IllegalArgumentException exception) {
                        throw new RejectedInstallException("The update redirected to an unapproved host.");
                    }
                    if (!isAllowedReleaseDownloadUrl(resolvedLocation)) {
                        throw new RejectedInstallException("The update redirected to an unapproved host.");
                    }
                    currentUrl = resolvedLocation;
                    continue;
                }

                if (status != HttpURLConnection.HTTP_OK) {
                    throw new RejectedInstallException("Failed to download update (HTTP " + status + ").");
                }
                break;
            }

            String contentType = connection.getContentType();
            if (contentType != null) {
                String lowerType = contentType.toLowerCase(Locale.US);
                if (lowerType.startsWith("text/") || lowerType.contains("application/json")) {
                    throw new RejectedInstallException("The update response was not an APK.");
                }
            }

            Long contentLength = parseContentLengthHeader(connection.getHeaderField("Content-Length"));
            if (contentLength != null) {
                if (contentLength > MAX_UPDATE_SIZE_BYTES) {
                    throw new RejectedInstallException("The update exceeds the safe download size limit.");
                }
                if (expectedSize != null && !contentLength.equals(expectedSize)) {
                    throw new RejectedInstallException("The update size does not match GitHub metadata.");
                }
            }

            Long totalBytes = expectedSize != null ? expectedSize : contentLength;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[STREAM_BUFFER_BYTES];
            byte[] prefix = new byte[APK_ZIP_MAGIC.length];
            int prefixLen = 0;
            long downloadedBytes = 0L;
            int lastReportedProgress = -1;

            File parent = targetFile.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs() && !parent.isDirectory()) {
                throw new IOException("Unable to create cache directory");
            }

            storeStarted = true;
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(targetFile, false)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (read == 0) {
                        continue;
                    }
                    if (downloadedBytes + read > MAX_UPDATE_SIZE_BYTES) {
                        throw new RejectedInstallException("The update exceeds the safe download size limit.");
                    }
                    downloadedBytes += read;
                    if (expectedSize != null && downloadedBytes > expectedSize) {
                        throw new RejectedInstallException("The update size does not match GitHub metadata.");
                    }
                    for (int index = 0; index < read && prefixLen < APK_ZIP_MAGIC.length; index++) {
                        prefix[prefixLen++] = buffer[index];
                    }
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);

                    if (totalBytes != null && totalBytes > 0L) {
                        int progress = (int) Math.min(99L, Math.round((downloadedBytes * 100.0d) / totalBytes));
                        if (progress > lastReportedProgress) {
                            lastReportedProgress = progress;
                            emitDownloadProgress(progress);
                        }
                    }
                }
                output.flush();
            }

            if (downloadedBytes == 0L) {
                throw new RejectedInstallException("The update response was empty.");
            }
            if (expectedSize != null && downloadedBytes != expectedSize) {
                throw new RejectedInstallException("The update size does not match GitHub metadata.");
            }
            if (contentLength != null && downloadedBytes != contentLength) {
                throw new RejectedInstallException("The update size does not match GitHub metadata.");
            }
            if (prefixLen < APK_ZIP_MAGIC.length || !matchesZipMagic(prefix)) {
                throw new RejectedInstallException("The update response was not an APK.");
            }

            String actualSha256 = toLowerHex(digest.digest());
            if (!expectedSha256.equals(actualSha256)) {
                throw new RejectedInstallException("The update SHA-256 verification failed.");
            }

            completeOnDisk = true;
            emitDownloadProgress(100);
            return new DownloadOutcome(actualSha256, downloadedBytes);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
            if (!completeOnDisk && storeStarted && targetFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                targetFile.delete();
            }
        }
    }

    private void emitDownloadProgress(int progress) {
        try {
            JSObject payload = new JSObject();
            payload.put("progress", progress);
            notifyListeners("downloadProgress", payload);
        } catch (Exception ignored) {
            // Progress reporting is advisory and must not abort a valid transfer.
        }
    }

    static boolean isRedirectStatus(int status) {
        return status == HttpURLConnection.HTTP_MOVED_PERM
                || status == HttpURLConnection.HTTP_MOVED_TEMP
                || status == HttpURLConnection.HTTP_SEE_OTHER
                || status == 307
                || status == 308;
    }

    static boolean matchesZipMagic(byte[] prefix) {
        if (prefix == null || prefix.length < APK_ZIP_MAGIC.length) {
            return false;
        }
        for (int index = 0; index < APK_ZIP_MAGIC.length; index++) {
            if (prefix[index] != APK_ZIP_MAGIC[index]) {
                return false;
            }
        }
        return true;
    }

    static Long parseContentLengthHeader(String header) throws RejectedInstallException {
        if (header == null) {
            return null;
        }
        String trimmed = header.trim();
        if (trimmed.isEmpty() || !trimmed.matches("^\\d+$")) {
            throw new RejectedInstallException("The update response has an invalid size.");
        }
        try {
            long parsed = Long.parseLong(trimmed);
            if (parsed < 0L) {
                throw new RejectedInstallException("The update response has an invalid size.");
            }
            return parsed;
        } catch (NumberFormatException exception) {
            throw new RejectedInstallException("The update response has an invalid size.");
        }
    }

    static String normalizeSha256(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.regionMatches(true, 0, "sha256:", 0, 7)) {
            trimmed = trimmed.substring(7);
        }
        if (trimmed.length() != 64) {
            return null;
        }
        for (int index = 0; index < 64; index++) {
            char ch = trimmed.charAt(index);
            boolean hex = (ch >= '0' && ch <= '9')
                    || (ch >= 'a' && ch <= 'f')
                    || (ch >= 'A' && ch <= 'F');
            if (!hex) {
                return null;
            }
        }
        return trimmed.toLowerCase(Locale.US);
    }

    static String toLowerHex(byte[] bytes) {
        if (bytes == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            int unsigned = value & 0xff;
            if (unsigned < 0x10) {
                builder.append('0');
            }
            builder.append(Integer.toHexString(unsigned));
        }
        return builder.toString();
    }

    /**
     * Enforces the same HTTPS GitHub release & CDN asset allowlist on the native download path
     * that {@code updateService.ts} enforces on the web layer, including every redirect target.
     */
    static boolean isAllowedReleaseDownloadUrl(String value) {
        if (value == null || value.isEmpty() || value.length() > 2048) {
            return false;
        }
        for (int index = 0; index < value.length(); index++) {
            char ch = value.charAt(index);
            if (ch <= 0x20 || ch == 0x7f) {
                return false;
            }
        }
        String rawPath = extractRawPath(value);
        String lowerRawPath = rawPath.toLowerCase(Locale.US);
        if (rawPath.indexOf('\\') >= 0
                || lowerRawPath.contains("%2e")
                || lowerRawPath.contains("%5c")) {
            return false;
        }

        URI uri;
        try {
            uri = new URI(value);
        } catch (Exception exception) {
            return false;
        }
        String scheme = uri.getScheme();
        if (scheme == null || !"https".equalsIgnoreCase(scheme)) {
            return false;
        }
        if (uri.getRawUserInfo() != null || uri.getRawFragment() != null) {
            return false;
        }
        int port = uri.getPort();
        if (port != -1 && port != 443) {
            return false;
        }
        String host = uri.getHost();
        if (host == null || host.isEmpty() || host.endsWith(".") || host.indexOf('%') >= 0) {
            return false;
        }
        String lowerHost = host.toLowerCase(Locale.US);
        String uriRawPath = uri.getRawPath();
        String decodedPath = uri.getPath();
        if (uriRawPath == null
                || uriRawPath.isEmpty()
                || decodedPath == null
                || decodedPath.isEmpty()
                || decodedPath.indexOf('\\') >= 0
                || containsTraversal(uriRawPath)
                || containsTraversal(decodedPath)) {
            return false;
        }
        if (GITHUB_HOST.equals(lowerHost)) {
            return uriRawPath.startsWith(GITHUB_RELEASE_PATH_PREFIX);
        }
        if (RELEASE_ASSETS_HOST.equals(lowerHost)) {
            return uriRawPath.startsWith(ASSET_PATH_PREFIX)
                    || uriRawPath.startsWith(ASSET_BUCKET_PATH_PREFIX);
        }
        if (OBJECTS_ASSETS_HOST.equals(lowerHost)) {
            return uriRawPath.startsWith(ASSET_BUCKET_PATH_PREFIX);
        }
        return false;
    }

    private static String extractRawPath(String value) {
        int schemeEnd = value.indexOf("://");
        String afterScheme = schemeEnd == -1 ? value : value.substring(schemeEnd + 3);
        int pathStart = -1;
        for (int index = 0; index < afterScheme.length(); index++) {
            char ch = afterScheme.charAt(index);
            if (ch == '/' || ch == '?' || ch == '#') {
                pathStart = index;
                break;
            }
        }
        if (pathStart == -1) {
            return "";
        }
        String fromPath = afterScheme.substring(pathStart);
        for (int index = 0; index < fromPath.length(); index++) {
            char ch = fromPath.charAt(index);
            if (ch == '?' || ch == '#') {
                return fromPath.substring(0, index);
            }
        }
        return fromPath;
    }

    private static File resolveCacheTarget(Context context, String input) throws IOException,
            RejectedInstallException {
        if (context == null
                || input == null
                || input.trim().isEmpty()
                || input.indexOf('\0') >= 0) {
            throw new RejectedInstallException("APK path is required");
        }
        Uri uri = Uri.parse(input);
        return resolveTargetApkFile(
                input,
                uri.getScheme(),
                uri.getPath(),
                uri.getEncodedQuery(),
                uri.getEncodedFragment(),
                uri.getEncodedPath(),
                context.getCacheDir()
        );
    }

    static File resolveTargetApkFile(
            String input,
            String scheme,
            String decodedPath,
            String encodedQuery,
            String encodedFragment,
            String encodedPath,
            File cacheDir
    ) throws IOException, RejectedInstallException {
        if (cacheDir == null) {
            throw new RejectedInstallException("Application cache is unavailable");
        }
        if (encodedQuery != null || encodedFragment != null) {
            throw new RejectedInstallException("APK path must reference the app cache");
        }
        String path = input;
        if (scheme != null) {
            if (!"file".equalsIgnoreCase(scheme)) {
                throw new RejectedInstallException("APK path must reference the app cache");
            }
            path = decodedPath;
        }
        if (path == null
                || path.isEmpty()
                || containsTraversal(path)
                || containsTraversal(input)
                || containsTraversal(encodedPath)) {
            throw new RejectedInstallException("APK path is not allowed");
        }
        File candidate = new File(path);
        if (!candidate.isAbsolute()) {
            candidate = new File(cacheDir, path);
        }
        File canonicalFile = candidate.getCanonicalFile();
        File canonicalCache = cacheDir.getCanonicalFile();
        if (canonicalFile.equals(canonicalCache) || !isInsideDirectory(canonicalFile, canonicalCache)) {
            throw new RejectedInstallException("APK path must be inside the app cache");
        }
        if (canonicalFile.isDirectory()) {
            throw new RejectedInstallException("APK path is not allowed");
        }
        return canonicalFile;
    }

    private static File resolveCacheFile(Context context, String input) throws IOException,
            RejectedInstallException {
        if (context == null
                || input == null
                || input.trim().isEmpty()
                || input.indexOf('\0') >= 0) {
            throw new RejectedInstallException("APK path is required");
        }

        // Uri is the only Android type in the path policy, so the decision itself is handed to a
        // static helper that works on plain strings and java.io.File and can be tested off-device.
        Uri uri = Uri.parse(input);
        return resolveApkFile(
                input,
                uri.getScheme(),
                uri.getPath(),
                uri.getEncodedQuery(),
                uri.getEncodedFragment(),
                uri.getEncodedPath(),
                context.getCacheDir()
        );
    }

    /**
     * The whole path policy for an install, with every {@code Uri} accessor already extracted.
     *
     * <p>{@code input} is the raw bridge string, {@code decodedPath} the path {@code Uri}
     * resolved out of it (null for a relative reference with no leading slash), and
     * {@code encodedPath} the same component still percent-encoded. Checking all three spellings
     * is what makes a single decode pass unable to smuggle a traversal past the guard, and the
     * canonical containment check below then covers everything the string tests cannot see.
     */
    static File resolveApkFile(
            String input,
            String scheme,
            String decodedPath,
            String encodedQuery,
            String encodedFragment,
            String encodedPath,
            File cacheDir
    ) throws IOException, RejectedInstallException {
        if (cacheDir == null) {
            throw new RejectedInstallException("Application cache is unavailable");
        }
        // A query or fragment is never part of a file name. Rejecting one regardless of the
        // scheme matters because a scheme-less reference is passed through as a raw string, and
        // the trailing "?x=1" would otherwise survive all the way to the filesystem lookup.
        if (encodedQuery != null || encodedFragment != null) {
            throw new RejectedInstallException("APK path must reference the app cache");
        }

        String path = input;
        if (scheme != null) {
            if (!"file".equalsIgnoreCase(scheme)) {
                throw new RejectedInstallException("APK path must reference the app cache");
            }
            path = decodedPath;
        }
        if (path == null
                || path.isEmpty()
                || containsTraversal(path)
                || containsTraversal(input)
                || containsTraversal(encodedPath)) {
            throw new RejectedInstallException("APK path is not allowed");
        }

        File candidate = new File(path);
        if (!candidate.isAbsolute()) {
            candidate = new File(cacheDir, path);
        }
        // getCanonicalFile resolves "..", symlinks and redundant separators, so the containment
        // check below cannot be bypassed by any spelling of the path.
        File canonicalFile = candidate.getCanonicalFile();
        File canonicalCache = cacheDir.getCanonicalFile();
        if (!isInsideDirectory(canonicalFile, canonicalCache)) {
            throw new RejectedInstallException("APK path must be inside the app cache");
        }
        if (!canonicalFile.isFile()) {
            throw new RejectedInstallException("APK file does not exist");
        }
        if (canonicalFile.length() <= 0L) {
            // A truncated download would otherwise reach the installer, which then shows a
            // parse error instead of anything the app can report.
            throw new RejectedInstallException("APK file is empty");
        }
        return canonicalFile;
    }

    /**
     * True when {@code file} is {@code directory} itself or sits below it. Both arguments must
     * already be canonical, and the separator is appended to {@code directory} so that a sibling
     * such as {@code /cache-evil} is not accepted for {@code /cache}.
     *
     * <p>Both sides are compared with {@code /} separators so the check does not depend on the
     * separator of whatever platform it is evaluated on. Android only ever uses {@code /}, but
     * this decision is also asserted directly by the unit tests, which run on a desktop JVM.
     */
    static boolean isInsideDirectory(File file, File directory) {
        if (file == null || directory == null) {
            return false;
        }
        String directoryPath = normalizeSeparators(directory.getPath());
        String filePath = normalizeSeparators(file.getPath());
        if (filePath.equals(directoryPath)) {
            return true;
        }
        return filePath.startsWith(
                directoryPath.endsWith("/") ? directoryPath : directoryPath + "/"
        );
    }

    private static String normalizeSeparators(String path) {
        return path == null ? "" : path.replace('\\', '/');
    }

    @SuppressWarnings("deprecation")
    private static void validatePackageArchive(Context context, File apkFile) throws Exception {
        PackageManager packageManager = context.getPackageManager();
        // Include both GET_SIGNING_CERTIFICATES and GET_SIGNATURES on API 28+: several Android
        // builds only trigger certificate collection on archive files when GET_SIGNATURES is
        // present, or populate signatures alongside signingInfo.
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? (PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_SIGNATURES)
                : PackageManager.GET_SIGNATURES;
        PackageInfo archiveInfo;
        try {
            archiveInfo = packageManager.getPackageArchiveInfo(apkFile.getAbsolutePath(), flags);
        } catch (Exception exception) {
            // Some platform builds throw on a malformed archive rather than returning null.
            // Folded into the same refusal as the null case below so the user gets one message
            // for "this is not a readable package" instead of a generic install failure.
            throw new RejectedInstallException(UNREADABLE_PACKAGE_MESSAGE);
        }
        if (archiveInfo == null) {
            // Null means either a file that is not an APK at all or one the parser could not
            // read. The zero-length check upstream already catches a truncated download, so
            // what is left here is a non-APK sitting in the cache.
            throw new RejectedInstallException(UNREADABLE_PACKAGE_MESSAGE);
        }
        if (archiveInfo.packageName == null
                || !context.getPackageName().equals(archiveInfo.packageName)) {
            throw new RejectedInstallException("APK package does not match this application");
        }

        PackageInfo installedInfo;
        try {
            installedInfo = packageManager.getPackageInfo(context.getPackageName(), flags);
        } catch (PackageManager.NameNotFoundException exception) {
            throw new RejectedInstallException("Installed package information is unavailable");
        }
        if (!isAcceptableVersion(versionCode(archiveInfo), versionCode(installedInfo))) {
            throw new RejectedInstallException("APK version is older than the installed version");
        }
        verifySameSigner(archiveInfo, installedInfo);
    }

    /**
     * Whether an archive's version code may replace the installed one.
     *
     * <p>An equal version code is accepted, not rejected. Reinstalling the identical build is a
     * legitimate outcome - a repair after a botched install, a same-version download from a
     * mirror - and refusing it would leave the user with no way to recover. A strictly lower
     * code is a downgrade, which the platform blocks anyway and which is refused here first so
     * the refusal is a message about the update rather than an installer error.
     *
     * <p>The comparison is on the long form of the version code throughout, so a build whose
     * {@code versionCode} exceeds {@code Integer.MAX_VALUE} cannot wrap into an "upgrade".
     */
    static boolean isAcceptableVersion(long archiveVersionCode, long installedVersionCode) {
        return archiveVersionCode >= installedVersionCode;
    }

    private static void verifySameSigner(PackageInfo archiveInfo, PackageInfo installedInfo)
            throws RejectedInstallException {
        Set<String> archiveSigners = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? apkSignersWithFallback(archiveInfo)
                : legacySigners(archiveInfo);
        if (archiveSigners.isEmpty()) {
            throw new RejectedInstallException("APK is not signed");
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // getSigningCertificateHistory() only describes the current signer, so a rotated
            // key upgrade is accepted as long as the archive signer appears in that history.
            Set<String> trustedHistory = trustedSignersWithFallback(installedInfo);
            if (!isSignerSubset(archiveSigners, trustedHistory)) {
                throw new RejectedInstallException(
                        "APK is not signed by this application's signer"
                );
            }
            return;
        }
        if (!isSignerSubset(archiveSigners, legacySigners(installedInfo))) {
            throw new RejectedInstallException("APK is not signed by this application's signer");
        }
    }

    private static Set<String> apkSignersWithFallback(PackageInfo archiveInfo) {
        if (archiveInfo == null) {
            return new HashSet<>();
        }
        Set<String> signers = apkContentsSigners(archiveInfo.signingInfo);
        if (signers.isEmpty()) {
            signers = signingCertificateHistory(archiveInfo.signingInfo);
        }
        if (signers.isEmpty()) {
            signers = legacySigners(archiveInfo);
        }
        return signers;
    }

    private static Set<String> trustedSignersWithFallback(PackageInfo installedInfo) {
        if (installedInfo == null) {
            return new HashSet<>();
        }
        Set<String> trusted = new HashSet<>();
        trusted.addAll(signingCertificateHistory(installedInfo.signingInfo));
        trusted.addAll(apkContentsSigners(installedInfo.signingInfo));
        trusted.addAll(legacySigners(installedInfo));
        return trusted;
    }

    /**
     * The archive's signers must be non-empty and every one of them must be trusted. A larger
     * archive signer set than the trusted set is a downgrade of the multi-signer guarantee, and
     * an empty trusted set means the installed signature could not be read at all.
     */
    static boolean isSignerSubset(Set<String> archiveSigners, Set<String> trustedSigners) {
        if (archiveSigners == null || trustedSigners == null) {
            return false;
        }
        if (archiveSigners.isEmpty() || trustedSigners.isEmpty()) {
            return false;
        }
        return trustedSigners.containsAll(archiveSigners);
    }

    private static Set<String> apkContentsSigners(SigningInfo signingInfo) {
        if (signingInfo == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return new HashSet<>();
        }
        return toFingerprints(signingInfo.getApkContentsSigners());
    }

    private static Set<String> signingCertificateHistory(SigningInfo signingInfo) {
        if (signingInfo == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return new HashSet<>();
        }
        if (signingInfo.hasMultipleSigners()) {
            // There is no history for a multi-signer package; the current signers are all that
            // can be trusted, and getSigningCertificateHistory() throws for this case.
            return toFingerprints(signingInfo.getApkContentsSigners());
        }
        return toFingerprints(signingInfo.getSigningCertificateHistory());
    }

    @SuppressWarnings("deprecation")
    private static Set<String> legacySigners(PackageInfo packageInfo) {
        if (packageInfo == null) {
            return new HashSet<>();
        }
        return toFingerprints(packageInfo.signatures);
    }

    private static Set<String> toFingerprints(Signature[] signatures) {
        Set<String> fingerprints = new HashSet<>();
        if (signatures == null) {
            return fingerprints;
        }
        for (Signature signature : signatures) {
            if (signature != null) {
                fingerprints.add(signature.toCharsString());
            }
        }
        return fingerprints;
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo packageInfo) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return packageInfo.getLongVersionCode();
        }
        return packageInfo.versionCode;
    }

    /**
     * Rejects both the plain ".." segment and its percent-encoded spellings, on the raw input,
     * the decoded path and the encoded path, so no single decoding pass can smuggle one past
     * the check.
     */
    static boolean containsTraversal(String path) {
        if (path == null) {
            return false;
        }
        String normalized = path.replace('\\', '/');
        if (normalized.toLowerCase(Locale.US).contains("%2e%2e")) {
            return true;
        }
        String[] segments = normalized.split("/");
        for (String segment : segments) {
            if ("..".equals(segment)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Starts an intent from the plugin thread, which has no activity of its own once the host is
     * gone. The {@code NEW_TASK} flag is added only on that path: with an activity present the
     * intent belongs in the current task, and for the settings screens forcing a new task would
     * leave the user in one they have to navigate back out of.
     */
    private void launch(Context context, Intent intent) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.startActivity(intent);
            return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private static final class DownloadOutcome {
        final String sha256;
        final long size;

        DownloadOutcome(String sha256, long size) {
            this.sha256 = sha256;
            this.size = size;
        }
    }

    /**
     * A validation failure whose message is written for the user. Separating it from
     * IllegalArgumentException keeps third-party messages, which embed filesystem paths, from
     * being forwarded to the web layer. Package-private so the path policy can be asserted on
     * from the unit tests without widening anything outside this package.
     */
    static final class RejectedInstallException extends Exception {

        RejectedInstallException(String message) {
            super(message);
        }
    }
}
