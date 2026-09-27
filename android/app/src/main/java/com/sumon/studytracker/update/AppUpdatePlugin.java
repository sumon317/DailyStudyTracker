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
import java.io.IOException;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "NativeAppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String FILE_PROVIDER_SUFFIX = ".fileprovider";

    /**
     * Forwarded to the web layer, so it must stay free of the resolved path and the provider
     * authority. A named constant rather than a literal at each throw site, because a package
     * can fail to parse in two different ways and the two copies of a user-facing string are
     * exactly the kind that drift.
     */
    static final String UNREADABLE_PACKAGE_MESSAGE = "APK could not be read as an Android package";

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
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
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

    private static void validatePackageArchive(Context context, File apkFile) throws Exception {
        PackageManager packageManager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
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
                ? apkContentsSigners(archiveInfo.signingInfo)
                : legacySigners(archiveInfo);
        if (archiveSigners.isEmpty()) {
            throw new RejectedInstallException("APK is not signed");
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // getSigningCertificateHistory() only describes the current signer, so a rotated
            // key upgrade is accepted as long as the archive signer appears in that history.
            Set<String> trustedHistory = signingCertificateHistory(installedInfo.signingInfo);
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
        if (signingInfo == null) {
            return new HashSet<>();
        }
        return toFingerprints(signingInfo.getApkContentsSigners());
    }

    private static Set<String> signingCertificateHistory(SigningInfo signingInfo) {
        if (signingInfo == null) {
            return new HashSet<>();
        }
        if (signingInfo.hasMultipleSigners()) {
            // There is no history for a multi-signer package; the current signers are all that
            // can be trusted, and getSigningCertificateHistory() throws for this case.
            return toFingerprints(signingInfo.getApkContentsSigners());
        }
        return toFingerprints(signingInfo.getSigningCertificateHistory());
    }

    private static Set<String> legacySigners(PackageInfo packageInfo) {
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
