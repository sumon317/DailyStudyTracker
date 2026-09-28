package com.sumon.studytracker.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Covers the JVM-safe parts of the install path: traversal rejection, cache containment and
 * the signer comparison. None of these helpers may call into the Android framework.
 */
public class AppUpdatePathTest {

    private static final File CACHE = new File("/data/user/0/com.sumon.studytracker/cache");

    /**
     * A real directory, for the cases that depend on canonicalisation and on the file system
     * rather than on string comparisons alone.
     */
    @Rule
    public final TemporaryFolder cache = new TemporaryFolder();

    @Test
    public void acceptsPlainCacheRelativeNames() {
        assertFalse(AppUpdatePlugin.containsTraversal("update.apk"));
        assertFalse(AppUpdatePlugin.containsTraversal("/data/user/0/pkg/cache/update.apk"));
        assertFalse(AppUpdatePlugin.containsTraversal("./update.apk"));
        assertFalse(AppUpdatePlugin.containsTraversal("nested/dir/update.apk"));
    }

    @Test
    public void rejectsDotDotSegments() {
        assertTrue(AppUpdatePlugin.containsTraversal("../secrets.txt"));
        assertTrue(AppUpdatePlugin.containsTraversal("/cache/../../secrets.txt"));
        assertTrue(AppUpdatePlugin.containsTraversal("a/../../b"));
        assertTrue(AppUpdatePlugin.containsTraversal(".."));
    }

    @Test
    public void rejectsWindowsStyleSeparators() {
        assertTrue(AppUpdatePlugin.containsTraversal("..\\secrets.txt"));
        assertTrue(AppUpdatePlugin.containsTraversal("a\\..\\..\\b"));
    }

    @Test
    public void rejectsPercentEncodedTraversalInAnyCase() {
        assertTrue(AppUpdatePlugin.containsTraversal("%2e%2e/secrets.txt"));
        assertTrue(AppUpdatePlugin.containsTraversal("%2E%2E%2Fsecrets.txt"));
        assertTrue(AppUpdatePlugin.containsTraversal("a/%2e%2e/b"));
    }

    @Test
    public void toleratesNullAndDotsThatAreNotTraversal() {
        assertFalse(AppUpdatePlugin.containsTraversal(null));
        assertFalse(AppUpdatePlugin.containsTraversal(""));
        assertFalse(AppUpdatePlugin.containsTraversal("..apk"));
        assertFalse(AppUpdatePlugin.containsTraversal("a..b"));
        // Not a traversal segment, so it survives the encoded pass too; what actually stops it
        // is the canonical containment check.
        assertFalse(AppUpdatePlugin.containsTraversal("safe%2etxt"));
    }

    @Test
    public void rejectsAnyPathContainingTheEncodedDotDotSequence() {
        // The check is deliberately a substring test, so a filename that merely embeds the
        // encoded sequence is refused as well.
        assertTrue(AppUpdatePlugin.containsTraversal("%2e%2esafe"));
        assertTrue(AppUpdatePlugin.containsTraversal("dir/%2E%2E"));
    }

    @Test
    public void containmentAcceptsFilesInsideTheCache() {
        assertTrue(AppUpdatePlugin.isInsideDirectory(
                new File(CACHE, "update.apk"),
                CACHE
        ));
        assertTrue(AppUpdatePlugin.isInsideDirectory(
                new File(CACHE, "nested/update.apk"),
                CACHE
        ));
    }

    @Test
    public void containmentAcceptsTheCacheDirectoryItself() {
        assertTrue(AppUpdatePlugin.isInsideDirectory(CACHE, CACHE));
    }

    @Test
    public void containmentRejectsSiblingsWithASharedPrefix() {
        assertFalse(AppUpdatePlugin.isInsideDirectory(
                new File("/data/user/0/com.sumon.studytracker/cache-evil/update.apk"),
                CACHE
        ));
    }

    @Test
    public void containmentRejectsParentAndUnrelatedDirectories() {
        assertFalse(AppUpdatePlugin.isInsideDirectory(
                new File(CACHE.getParentFile(), "files/update.apk"),
                CACHE
        ));
        assertFalse(AppUpdatePlugin.isInsideDirectory(
                new File("/data/local/tmp/update.apk"),
                CACHE
        ));
    }

    @Test
    public void containmentRejectsNulls() {
        assertFalse(AppUpdatePlugin.isInsideDirectory(null, CACHE));
        assertFalse(AppUpdatePlugin.isInsideDirectory(new File(CACHE, "update.apk"), null));
        assertFalse(AppUpdatePlugin.isInsideDirectory(null, null));
    }

    @Test
    public void acceptsAnExactSignerMatch() {
        assertTrue(AppUpdatePlugin.isSignerSubset(
                setOf("aa", "bb"),
                setOf("aa", "bb")
        ));
    }

    @Test
    public void acceptsAnArchiveSignedByAnOlderKeyInTheRotationHistory() {
        assertTrue(AppUpdatePlugin.isSignerSubset(setOf("old"), setOf("old", "current")));
    }

    @Test
    public void rejectsAnArchiveSignedByAnUnknownKey() {
        assertFalse(AppUpdatePlugin.isSignerSubset(setOf("other"), setOf("current")));
    }

    @Test
    public void rejectsASubsetCheckWhenEveryArchiveSignerMustMatch() {
        assertTrue(AppUpdatePlugin.isSignerSubset(setOf("aa"), setOf("aa", "bb")));
        assertFalse(AppUpdatePlugin.isSignerSubset(setOf("aa", "cc"), setOf("aa", "bb")));
    }

    @Test
    public void rejectsEmptyOrUnreadableSignerSets() {
        assertFalse(AppUpdatePlugin.isSignerSubset(Collections.emptySet(), setOf("aa")));
        assertFalse(AppUpdatePlugin.isSignerSubset(setOf("aa"), Collections.emptySet()));
        assertFalse(AppUpdatePlugin.isSignerSubset(Collections.emptySet(), Collections.emptySet()));
        assertFalse(AppUpdatePlugin.isSignerSubset(null, setOf("aa")));
        assertFalse(AppUpdatePlugin.isSignerSubset(setOf("aa"), null));
    }

    @Test
    public void acceptsACacheRelativeNameAndReturnsItsCanonicalPath() throws Exception {
        File root = cache.getRoot();
        File apk = writeNonEmptyFile(new File(root, "update.apk"));

        File resolved = resolve("update.apk", null, null, root);
        assertEquals(apk.getCanonicalFile(), resolved);
    }

    @Test
    public void acceptsAnAbsolutePathInsideTheCache() throws Exception {
        File root = cache.getRoot();
        File apk = writeNonEmptyFile(new File(root, "nested/update.apk"));
        String absolute = apk.getAbsolutePath();

        assertEquals(apk.getCanonicalFile(), resolve(absolute, null, absolute, root));
    }

    @Test
    public void acceptsAFileUriPointingInsideTheCache() throws Exception {
        File root = cache.getRoot();
        File apk = writeNonEmptyFile(new File(root, "update.apk"));
        String path = apk.getAbsolutePath();

        // A file Uri carries the path in the same component the relative form resolves against,
        // so the decoded path is what the containment check has to judge.
        assertEquals(apk.getCanonicalFile(), resolve("file://" + path, "file", path, root));
    }

    @Test
    public void rejectsEverySchemeOtherThanFile() {
        File root = cache.getRoot();
        assertRejected("content://com.example.provider/update.apk", "content", null, root);
        assertRejected("https://example.com/update.apk", "https", null, root);
        assertRejected("javascript:alert(1)", "javascript", null, root);
    }

    @Test
    public void aMixedCaseFileSchemeStillHasToPassContainment() throws Exception {
        // URI schemes are case insensitive, so this is not a rejection of its own: it passes the
        // scheme test and is then refused because the path is not in the cache. Asserting the
        // message pins down where the decision is made instead of only that it happened.
        File root = cache.getRoot();
        String outside = new File(root.getParentFile(), "elsewhere.apk").getAbsolutePath();
        try {
            AppUpdatePlugin.resolveApkFile("FILE://" + outside, "FILE", outside, null, null,
                    outside, root);
            fail("A path outside the cache must be refused whatever the scheme's case");
        } catch (AppUpdatePlugin.RejectedInstallException expected) {
            assertEquals("APK path must be inside the app cache", expected.getMessage());
        }
    }

    @Test
    public void rejectsAQueryOrFragmentEvenWithoutAScheme() {
        // A scheme-less reference is passed through as a raw string, so a trailing "?x=1" would
        // otherwise survive every check and reach the filesystem lookup as part of the name.
        assertRejectedWithQuery("update.apk?x=1", null, "x=1", null);
        assertRejectedWithQuery("update.apk#frag", null, null, "frag");
        assertRejectedWithQuery("file:///cache/update.apk?v=2", "file", "v=2", null);
    }

    @Test
    public void rejectsTraversalInAnyOfTheThreeSpellings() throws Exception {
        File root = cache.getRoot();
        assertRejected("../secrets.txt", null, null, root);
        assertRejected("a/../../b.apk", null, null, root);
        assertRejected("%2e%2e/secrets.apk", null, null, root);
        // The encoded spelling has to be refused even when the decoded one looks harmless.
        try {
            AppUpdatePlugin.resolveApkFile("%2e%2e/secrets.apk", null, "secrets.apk", null, null,
                    "%2e%2e/secrets.apk", root);
            fail("An encoded traversal must be refused even with a clean decoded path");
        } catch (AppUpdatePlugin.RejectedInstallException expected) {
            assertEquals("APK path is not allowed", expected.getMessage());
        }
    }

    @Test
    public void rejectsFilesOutsideTheCacheEvenWithoutTraversalSpelling() throws Exception {
        // The cache is nested inside the rule's folder so the shared-prefix sibling lives in a
        // directory the rule still cleans up.
        File root = new File(cache.getRoot(), "cache");
        assertTrue(root.isDirectory() || root.mkdirs());
        File sibling = new File(cache.getRoot(), "cache-evil");
        assertTrue(sibling.isDirectory() || sibling.mkdirs());
        File outside = writeNonEmptyFile(new File(sibling, "update.apk"));

        // No ".." anywhere: only the canonical containment check can separate the sibling from
        // the cache it shares a name prefix with.
        assertRejected(outside.getAbsolutePath(), null, outside.getAbsolutePath(), root);
        assertRejected(root.getParentFile().getAbsolutePath(), null, null, root);
    }

    @Test
    public void rejectsAMissingFileADirectoryAndAnEmptyFile() throws Exception {
        File root = cache.getRoot();
        assertRejected("missing.apk", null, null, root);

        assertTrue(new File(root, "nested").mkdirs());
        assertRejected("nested", null, null, root);

        assertTrue(new File(root, "empty.apk").createNewFile());
        assertRejected("empty.apk", null, null, root);
    }

    @Test
    public void refusesToResolveWithoutACacheDirectory() {
        try {
            resolve("update.apk", null, null, null);
            fail("A missing cache directory must be refused");
        } catch (IOException unexpected) {
            fail("A missing cache directory is not an IO failure");
        } catch (AppUpdatePlugin.RejectedInstallException expected) {
            assertEquals("Application cache is unavailable", expected.getMessage());
        }
    }

    @Test
    public void acceptsAnEqualVersionCode() {
        // A same-version reinstall is a legitimate recovery after a botched install, and
        // refusing it would leave the user with no way back. Only a strictly lower code is a
        // downgrade.
        assertTrue(AppUpdatePlugin.isAcceptableVersion(20202L, 20202L));
    }

    @Test
    public void acceptsAHigherVersionCode() {
        assertTrue(AppUpdatePlugin.isAcceptableVersion(20203L, 20202L));
        assertTrue(AppUpdatePlugin.isAcceptableVersion(1L, 0L));
    }

    @Test
    public void rejectsALowerVersionCode() {
        assertFalse(AppUpdatePlugin.isAcceptableVersion(20201L, 20202L));
        assertFalse(AppUpdatePlugin.isAcceptableVersion(0L, 1L));
    }

    @Test
    public void theVersionComparisonIsSignedAndDoesNotWrap() {
        // versionCode is read as a long on API 28+, so a build past Integer.MAX_VALUE must not
        // wrap into looking like a downgrade. Both operands being signed longs, this holds.
        assertTrue(AppUpdatePlugin.isAcceptableVersion(Long.MAX_VALUE, Integer.MAX_VALUE));
        assertFalse(AppUpdatePlugin.isAcceptableVersion(0L, Long.MAX_VALUE));
        // Equal extremes are a reinstall, not a downgrade.
        assertTrue(AppUpdatePlugin.isAcceptableVersion(Long.MAX_VALUE, Long.MAX_VALUE));
    }

    @Test
    public void theUnreadablePackageMessageCarriesNoPathOrAuthority() {
        // Forwarded to the web layer, so it must not leak the resolved path or the FileProvider
        // authority, and it must not be empty (an empty rejection gives the user nothing).
        String message = AppUpdatePlugin.UNREADABLE_PACKAGE_MESSAGE;
        assertNotNull(message);
        assertFalse(message.trim().isEmpty());
        assertFalse(message.contains(".."));
        assertFalse(message.contains("/"));
        assertFalse(message.contains("\\"));
        assertFalse(message.contains("fileprovider"));
    }

    @Test
    public void rejectionMessagesNeverCarryAPath() {
        // These messages are forwarded to the web layer, so they must stay free of the resolved
        // absolute path and of the provider authority.
        try {
            resolve("../../etc/passwd", null, null, cache.getRoot());
            fail("Traversal must be refused");
        } catch (IOException unexpected) {
            fail("Unexpected IO failure");
        } catch (AppUpdatePlugin.RejectedInstallException expected) {
            assertFalse(expected.getMessage().contains(".."));
            assertFalse(expected.getMessage().contains(cache.getRoot().getAbsolutePath()));
        }
    }

    @Test
    public void aNonEmptyNonApkFileStillPassesThePathPolicy() throws Exception {
        // The path policy has nothing to say about the file's contents: a 64-byte file in the
        // cache is a legitimate resolve. Rejecting it here would be wrong, and the archive
        // validation that follows is what distinguishes it. This documents the boundary between
        // the two so a future check is not added to the wrong layer.
        File root = cache.getRoot();
        File notAnApk = writeNonEmptyFile(new File(root, "not-an-apk.bin"));
        try {
            assertEquals(notAnApk.getCanonicalFile(), resolve("not-an-apk.bin", null, null, root));
        } catch (Exception unexpected) {
            fail("The path policy must not inspect file contents: " + unexpected);
        }
    }

    @Test
    public void theCacheRootItselfIsADirectoryAndSoIsRefused() {
        // isFile() is what separates a directory from an archive, so the cache directory itself
        // has to be refused even though it is inside the cache.
        try {
            resolve(cache.getRoot().getAbsolutePath(), null, null, cache.getRoot());
            fail("A directory must not resolve to an installable archive");
        } catch (IOException unexpected) {
            fail("Unexpected IO failure");
        } catch (AppUpdatePlugin.RejectedInstallException expected) {
            assertEquals("APK file does not exist", expected.getMessage());
        }
    }

    private static File resolve(
            String input,
            String scheme,
            String decodedPath,
            File cacheDir
    ) throws IOException, AppUpdatePlugin.RejectedInstallException {
        return AppUpdatePlugin.resolveApkFile(
                input,
                scheme,
                decodedPath,
                null,
                null,
                decodedPath,
                cacheDir
        );
    }

    /**
     * Asserts the given spelling of a path is refused, and that the refusal carries a message
     * that is safe to show to the user.
     */
    private static void assertRejected(
            String input,
            String scheme,
            String decodedPath,
            File cacheDir
    ) {
        try {
            resolve(input, scheme, decodedPath, cacheDir);
            fail("Expected the path to be refused: " + input);
        } catch (IOException unexpected) {
            fail("Unexpected IO failure for: " + input);
        } catch (AppUpdatePlugin.RejectedInstallException expected) {
            assertTrue(expected.getMessage() != null && !expected.getMessage().isEmpty());
        }
    }

    /**
     * The query-carrying half of the previous check, spelled out because it is the one place
     * where the components {@code Uri} would have produced matter.
     */
    private void assertRejectedWithQuery(
            String input,
            String scheme,
            String query,
            String fragment
    ) {
        try {
            AppUpdatePlugin.resolveApkFile(
                    input,
                    scheme,
                    input,
                    query,
                    fragment,
                    input,
                    cache.getRoot()
            );
            fail("Expected the path to be refused: " + input);
        } catch (IOException unexpected) {
            fail("Unexpected IO failure for: " + input);
        } catch (AppUpdatePlugin.RejectedInstallException expected) {
            assertEquals("APK path must reference the app cache", expected.getMessage());
        }
    }

    private static File writeNonEmptyFile(File file) throws IOException {
        File parent = file.getParentFile();
        assertTrue(parent.isDirectory() || parent.mkdirs());
        assertTrue(file.createNewFile());
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(0x50);
        }
        return file;
    }

    private static Set<String> setOf(String... values) {
        return new HashSet<>(Arrays.asList(values));
    }
}
