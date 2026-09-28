# Daily Study Tracker

Daily Study Tracker is a local-first React application for recording study sessions, checklist work, mistakes, todos, focus time, and progress statistics. It runs as a web app, an installable PWA, and a Capacitor Android project.

There is no account system or cloud database. Data stays in the current browser or device unless the user exports a backup.

## Features

- Daily subjects with planned and actual study time, KPI status, and reminders
- Recurring subjects, checklists, quality checks, and an error log
- Daily, weekly, streak, and completion statistics
- Todos, stopwatch, and configurable focus countdown
- PDF and Markdown exports
- Versioned JSON backup and restore with legacy backup support
- Light, dark, system, Material, and adaptive color themes
- Browser notifications and Android local notifications
- Installable PWA with a generated service worker and offline application shell

## Runtime behavior and limitations

- Web data is stored in IndexedDB. Android data is stored through Capacitor Filesystem; native writes use a temporary file and atomic rename when available, and persistence errors are surfaced to the user.
- Changes are saved locally and periodically while the app is open. Clearing site data, uninstalling the app, or losing device storage can remove data.
- There is no cloud sync. Use Backup before moving data to another browser or device.
- Web reminders use the browser Notification API and a timer while the page remains open. Browsers can throttle background tabs, and closing the page can prevent a reminder.
- Android reminders use native local notifications. Exact-alarm permission, battery optimization, vendor-specific background restrictions, and force-stop behavior can affect delivery.
- The exact-alarm permission sheet is rate limited rather than permanent: dismissing it records a timestamp and the sheet returns after 24 hours if the permission is still missing. Returning to the foreground re-reads the permission and reconciles the pending schedule, because Android can revoke the grant or clear pending alarms while the app is backgrounded.
- PWA offline support covers the generated application shell and build assets after at least one successful production load over HTTPS. Network-only features are not guaranteed offline. The alarm tone (`public/alarm_loop.mp3`, ~1.4 MiB) is deliberately precached so the in-app alarm still sounds with no network.
- The in-app release checker runs on Android. The protected tag workflow publishes a signed APK when its signing secrets are configured, along with web artifacts and checksums.

### Android alarm delivery

- Alarms are delivered by `AlarmActivity` (launched from `alarm/AlarmReceiver` when an `AlarmManager` alarm fires) plus a high-importance local notification on the `native_alarm` channel ("Study Alarms"). That channel plays the system alarm ringtone; `AlarmActivity` itself streams the bundled `android/app/src/main/res/raw/alarm_loop.mp3` (8.5 MiB).
- The app **does** declare `USE_FULL_SCREEN_INTENT`, and `AlarmNotifications` calls `setFullScreenIntent` on the alarm notification. It has to: from Android 10 (API 29) a `BroadcastReceiver` may not start an activity from the background, and an exact alarm only exempts a foreground *service* start. A system-sent `PendingIntent` and a full-screen intent are the two background activity launch paths the platform allows, so the full-screen intent is what puts `AlarmActivity` in front of the user when the app is not already in the foreground.
- From Android 14 (API 34) that permission is only granted to calling and alarm apps. This app ships outside the Play Store, where the install-time grant is the default, and it does schedule user alarms. The grant is still verified at runtime rather than assumed: `AlarmNotifications` attaches the full-screen intent unconditionally below API 34, and from API 34 only while `NotificationManager.canUseFullScreenIntent()` returns true. When the grant is missing the notification degrades to a heads-up notification, so the alarm is still announced but the user has to open the app.
- `android/app/src/main/res/raw/alarm_loop.mp3` (~8.5 MiB) is a separate, larger encode of the same tone from the ~1.4 MiB web asset. It is left as-is because re-encoding needs tooling that cannot be validated without a device build.

## Backup format

Backup downloads a file named `study-tracker-backup-YYYY-MM-DD.json`. The current schema is a versioned JSON envelope with these top-level fields:

- `schemaVersion`
- `exportedAt`
- `days`
- `recurringSubjects`
- `todos`
- `focusAlarms`
- `settings`

Restore validates and bounds the imported data. Current backups merge day records by date using the newest timestamp by default and restore current global study data. Legacy day arrays, single-day records, and older native storage shapes are converted during import.

Backup files are plain, unencrypted JSON. They can contain personal study notes, todos, and mistakes, so store and share them cautiously.

### Backup format limitations

- `schemaVersion` is currently `1`, and restore rejects any envelope whose `schemaVersion` is not exactly the value this build expects. There is no forward or backward migration path yet, so a future schema bump will make existing backup files unreadable until a migration is written. Keep backups you care about, and test restore after any app version that changes the format.
- Import is a merge, not a replace. Restoring a backup into a device that already holds data keeps the newer record per date and per global key, so a restore will not delete local data that the backup does not mention. There is no "wipe and replace" path.
- Import is bounded and validated, and the whole envelope is validated before any write, so a malformed or oversized file is rejected up front. The validation limits are internal constants and are neither documented nor versioned.
- The filename carries the local calendar date only. Two exports on the same day overwrite each other if saved to the same directory.

## Prerequisites

### Web and PWA development

- Bun 1.4.0 or newer
- Git

This repository standardizes on Bun. Do not use npm, Yarn, pnpm, or `package-lock.json`. CI and the Render blueprint pin the exact Bun version declared in `packageManager` (`bun@1.4.0`) and fail if the installed version differs; `1.4.0` is the minimum supported version. CI also provisions a pinned Node runtime because the Vitest coverage provider is not fully supported under Bun alone. Bun remains the package manager and project script runner.

### Android development

Capacitor 8 supports Android 7 / API 24 and newer. Android builds require:

- Android Studio 2025.2.1 or newer
- Android SDK tools and a supported SDK platform
- An API 24 or newer emulator or physical device
- A current Android System WebView on the device

The project does not include a signing key. No job in `.github/workflows/ci.yml` produces an APK; CI compiles and runs the Android JVM unit tests only (see [CI and releases](#ci-and-releases)). The tag-only release workflow defines a protected signed-APK build, but no Android build was run while preparing this tooling change.

## Setup

```bash
git clone https://github.com/sumon317/DailyStudyTracker.git
cd DailyStudyTracker
bun install
bun run dev
```

Use a frozen install in CI and when reproducing a deployed revision:

```bash
bun install --frozen-lockfile
```

Commit the generated `bun.lock`. Do not generate or commit `package-lock.json`.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Vite development server |
| `bun run build` | Build the production web app, manifest, and service worker |
| `bun run preview` | Serve the production build locally |
| `bun run lint` | Run Biome checks |
| `bun run typecheck` | Typecheck the app and active TypeScript/JavaScript configs |
| `bun run test:run` | Run the Vitest suite once |
| `bun run test:coverage` | Run tests with Istanbul coverage and global thresholds |
| `bun run config:check` | Parse active JSON and YAML configuration, and verify workflow structure and action pins |
| `bun run assets:check` | Verify that every asset referenced by `index.html`, `vite.config.ts`, and `src/**` exists in `public/`, that PNG dimensions match their declared sizes, and report unreferenced public assets |
| `bun run pwa:check` | Verify the built `dist/` output: manifest link and registration script injection, manifest icons present with matching sizes, and a duplicate-free precache manifest whose entries all exist |
| `bun run license:check` | Check installed dependency licenses against the project allowlist |
| `bun run verify` | Run configuration, asset, lint, type, coverage, build, and PWA output checks |
| `bun run android:sync` | Build web assets and sync them to the Android project |
| `bun run android:open` | Open the Android project in Android Studio |

Run `bun audit --audit-level=high` to audit installed dependencies. High and critical advisories fail CI. Moderate and low advisories do not fail the configured audit threshold and should be reviewed separately with `bun audit`.

`license:check` inspects every installed package reached through `node_modules`, including nested installs, and requires that a real install happened: it fails if `node_modules` is missing or if no package was inspected, so it cannot pass vacuously. It matches on the declared `license`/`licenses` field only. It does not read `LICENSE` files, does not evaluate SPDX expressions, and uses substring matching, so it is a floor rather than a complete license audit.

`assets:check` and `pwa:check` are the two asset gates. `assets:check` runs before a build and reads only committed sources, so it is safe to run at any time. `pwa:check` requires `dist/` and therefore runs after `bun run build`. Both are part of `bun run verify` and run in CI.

`assets:check` fails on a referenced asset that is missing, empty, or whose PNG dimensions disagree with its filename. An *unreferenced* file in `public/` is only reported as a warning. Four files are warned about today: `public/assets/blue_tang.png`, `clownfish.png`, `seaweed.png`, and `yellow_tang.png`. They are the source artwork the app icons were generated from and nothing in the app references them; because `workbox.globPatterns` matches `png`, they are copied into `dist/` and precached anyway, which is about 36 KB per install. Remove them if the artwork is not being kept for icon regeneration.

Coverage thresholds are deliberately modest global regression floors because the current suite covers core providers, utilities, the main tracker view, and part of the review flow. Coverage output is written to `coverage/` and is not committed.

## PWA behavior

`vite-plugin-pwa` generates the following files during `bun run build`:

- `dist/manifest.webmanifest`
- `dist/sw.js`
- `dist/registerSW.js`
- `dist/workbox-<hash>.js`, loaded by `dist/sw.js` via `importScripts`

The plugin injects the manifest and registration script into production HTML and registers an auto-updating service worker. The injected markup is external files only, with no inline script, so the deployed `script-src 'self'` policy in `render.yaml` is sufficient. Service workers are disabled during normal `bun run dev`; test them with:

```bash
bun run build
bun run preview
```

Do not add a second manual service-worker registration in `src/app/main.tsx`. Removing the old `/sw.js` registration is required so the generated registration is the only one.

The precache manifest must contain every precached URL and every manifest icon. `vite-plugin-pwa` adds the generated `manifest.webmanifest` and its own icon entries to the precache manifest, and `workbox.globPatterns` matches the same five URLs, so each of them appears exactly twice. That overlap is harmless, because both copies carry the same revision and workbox keys the precache by URL. Excluding them with `globIgnores` was tried and reverted: it removes the plugin-injected entries as well, which silently dropped the manifest and all four icons from the offline cache. `bun run pwa:check` therefore fails if a URL appears more than twice, if a URL is duplicated outside that known five-URL overlap, if a precached URL is missing from `dist/`, or if a manifest icon is not precached.

Alarm audio is a single asset, `public/alarm_loop.mp3` (~1.4 MiB), and it **is** precached: `mp3` is listed in `workbox.globPatterns` and the precache budget is 3 MiB, so the alarm still sounds with no network. `src/services/alarmAudio.ts` is the only place that names the URL. `android/app/src/main/res/raw/alarm_loop.mp3` is a separate native resource with the same file name and a much larger encode; `NOTIFICATION_SOUND` refers to that native name, not to the web URL, and the two must not be conflated.

A second, larger `public/alarm_loop_small.mp3` used to be referenced by the web alarm alongside `public/alarm_loop.mp3`. Despite the name it was twice the size of the file it shadowed, so the web alarm was downloading the larger asset and the offline story was broken. It has been removed in favour of the single canonical `alarm_loop.mp3`. If the tone is ever re-encoded, keep it under the precache budget or `pwa:check` / the workbox build will silently drop it from the offline cache.

To test installation and update behavior, serve the production build from HTTPS or from `localhost`, load it once, and use the browser's install and application controls. The checked-in 192 px and 512 px maskable icons and favicon are generated from the existing fish artwork, and `bun run assets:check` verifies that every declared size matches the actual PNG dimensions.

## Project structure

### Web and PWA

```
src/
  app/            App shell: App.tsx, main.tsx, global index.css
  components/
    charts/       StudyCharts, WeeklyStats
    dialogs/      AlarmPermissionModal, UpdateModal
    focus/        CountdownTimer, InbuiltAlarm, Stopwatch
    layout/       BottomNavigation, Layout, ThemeSelector
    review/       Checklist, QualityCheck, ErrorLog
    shared/       Clock, DatePicker, ErrorBoundary, SkeletonLoader, TimePicker
    tracker/      TrackerForm
  native/         Capacitor plugin bindings: NativeAlarm, NativeAppUpdate
  pages/          Route components: Focus, Review, Stats, Todo, Tracker
  providers/      DataProvider, ThemeProvider, ToastProvider
  services/
    export/       pdfGenerator, markdownGenerator
    storage.ts    Dexie schema, native persistence, backup/restore
    notificationService.ts, updateService.ts, widgetService.ts
    alarmAudio.ts Canonical alarm tone URL and the shared media/WebAudio wiring
  test/           setup.ts, test-utils.tsx, cross-component accessibility.test.tsx
  types/          Shared TypeScript types
  utils/          Pure helpers only: dateUtils, sanitize
```

Unit tests are co-located with the module they cover. `src/test/accessibility.test.tsx` is the one cross-component suite and lives with the test harness. There is no path alias configuration: imports are relative.

### Android

Java lives under `android/app/src/main/java/com/sumon/studytracker/`:

```
MainActivity                  BridgeActivity; registers the three local plugins
alarm/                        NativeAlarmPlugin, BootReceiver, AlarmReceiver, AlarmActivity
widget/                       StudyWidgetProvider, StudyWidgetService, WidgetDataPlugin,
                              WidgetDataStore, WidgetActionReceiver
update/                       AppUpdatePlugin
service/                      StopwatchService
```

Plugin names (`NativeAlarm`, `WidgetData`, `NativeAppUpdate`), JavaScript-facing strings such as intent action constants, `SharedPreferences` names, and the Gradle `namespace` are unchanged, so behavior and stored data are unaffected by the package split. `proguard-rules.pro` keeps `com.sumon.studytracker.**`, which covers the new subpackages, plus the Capacitor bridge, the foreground-service plugin and the manifest-declared receivers/services. The React Native, Fresco and blanket `com.**` rules the default template shipped with are removed: this project has no React Native or Fresco dependency, and `-keep class com.** { *; }` was disabling shrinking for every Capacitor and app class in release builds.

## Web deployment on Render

The root `render.yaml` defines a static service with:

- Bun 1.4.0, requested through the `BUN_VERSION` environment variable
- `bun install --frozen-lockfile && bun run build`
- `./dist` as the publish directory
- automatic pull-request previews
- a `/*` to `/index.html` rewrite for client-side routes
- no-cache headers for the service worker and registration script
- CSP, clickjacking, MIME-sniffing, referrer, permissions, and HSTS headers

Render honours `BUN_VERSION` on its Bun-aware static build image. If a future image ignores it, the build would fall back to whatever Bun that image ships, so verify the deployed Bun version on the first build after any Render image change.

Two details of the blueprint are load-bearing rather than cosmetic. The `/*` to `/index.html` rewrite only applies when no static file matches the request, so `/sw.js`, `/registerSW.js`, `/manifest.webmanifest` and the hashed `/assets/**` are served as themselves; without that, a client-side route and a hashed bundle would be indistinguishable to the router. And the `Cache-Control: public, max-age=0, must-revalidate` headers are attached to exactly those two service-worker paths, because a cached `sw.js` or registration script pins clients to a stale precache manifest — the hashed assets keep Render's default caching, which is correct because their names change when their content does.

`buildFilter` limits which paths trigger a rebuild to the web toolchain (`package.json`, `bun.lock`, the configs, `index.html`, `src/**`, `public/**`). Changes confined to `android/**`, `capacitor.config.json`, `README.md`, or `LICENSE` do not redeploy the web service, which is correct: none of them are inputs to `vite build`. A change to a file that *is* an input but missing from that list would not trigger a deploy, so add it to `buildFilter` in the same change that adds the file.

Create a Render Blueprint from this repository or apply the equivalent static-site settings. The existing deployment referenced by this project is `https://dailystudytracker.onrender.com`. A custom domain should use HTTPS for service workers, installation, and notifications.

## Android build

Build and validate the web application before syncing native assets:

```bash
bun run verify
bun run android:sync
bun run android:open
```

Use Android Studio to select an API 24 or newer device and build an APK or app bundle. Native alarm behavior, exact-alarm permission, foreground-service behavior, widgets, and release updates must be verified on physical Android hardware before distribution.

`versionName` and `versionCode` in `android/app/build.gradle` follow the tag: `versionCode` is `MAJOR * 1000000 + MINOR * 1000 + PATCH`, so `2.2.2` is `2002002`. The release workflow recomputes both from the tag before `assembleRelease`, which means the committed values only matter for local builds and must stay on the same scale or a local release APK would carry a lower code than the published one.

Android signing material must remain outside the repository. Typical ignored files include `*.jks`, `*.keystore`, `key_base64.txt`, and `android/local.properties`. Back up signing keys securely; losing them can prevent future updates.

The release build type is signed strictly: `signingConfigs.release` reads `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD` from the environment with no defaults, so an `assembleRelease` without the secrets fails instead of producing an unsigned APK. `storeFile` is `android/app/release-key.jks`, which is covered by `*.jks` in `.gitignore`; the release workflow writes it under `umask 077` and deletes it from an `EXIT` trap. Local debug builds do not use this config, so no key is needed for `testDebugUnitTest` or for Android Studio debug runs.

## CI and releases

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual dispatch. It checks out full history so the whitespace gate can see the base commit. It:

1. validates Bun and the presence of `bun.lock`
2. parses active JSON and YAML configuration and checks workflow structure and action pins
3. installs with `bun install --frozen-lockfile`
4. validates the dependency tree
5. blocks on high or critical dependency advisories
6. checks dependency licenses
7. validates public asset references and PNG dimensions
8. runs lint, typecheck, tests, and coverage
9. runs the production PWA build
10. validates the generated PWA output, including the precache manifest
11. checks whitespace errors in the base-to-head commit range and in the working tree

Steps 2, 6, 7, 10, and 11 are the same commands that `bun run verify` and the individual scripts run locally, so CI cannot pass on a gate that fails locally. The whitespace gate fails if the base commit cannot be resolved rather than silently skipping, so it can never degrade into a no-op.

A second job, `android-unit-tests`, runs the Android JVM unit tests (`android/app/src/test/**`) with the checked-in Gradle wrapper. It installs Bun, performs the same frozen install, runs `bun run android:sync` (web build plus `cap sync android`), uses the pinned `android-actions/setup-android` action to install the command-line tools, accept the SDK licences, and add `platforms;android-36` and `build-tools;36.0.0`, then runs `./gradlew testDebugUnitTest`. Both the install and the sync are load-bearing rather than incidental: `android/capacitor.settings.gradle` points the Gradle build at `../node_modules/@capacitor/*` and `android/app/capacitor.build.gradle` applies the gitignored `capacitor-cordova-android-plugins/cordova.variables.gradle`, so the build cannot even be configured — and the app's own plugin classes cannot be compiled — until `cap sync` has regenerated both. The job also asserts that `distributionUrl` is a pinned `services.gradle.org` URL and that `distributionSha256Sum` is present, so a wrapper that resolves to "latest" or an unverified download cannot pass. It is bounded by `timeout-minutes` because a wedged Gradle daemon would otherwise hold the run open for the 6-hour default.

The instrumented tests in `android/app/src/androidTest/**` are not run in CI: they need a connected device or emulator. The wrapper pins `gradle-8.11.1-bin.zip` with SHA-256 `f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6`, which matches the checksum published by `services.gradle.org`.

`.github/workflows/release.yml` runs only for a pushed `v*` tag and requires the protected GitHub Actions environment named `release`. Configure that environment with required reviewers and these secrets:

- `ANDROID_KEYSTORE_BASE64`
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS`
- `KEY_PASSWORD`

Before tagging:

1. Set `package.json` to the intended `MAJOR.MINOR.PATCH` version.
2. Regenerate and commit `bun.lock` with Bun.
3. Run `bun run verify`, the high-severity audit, and the license check.
4. Commit the version change.
5. Create and push the canonical annotated tag, for example `v2.3.0`.

The release workflow rejects non-canonical tags, verifies that the tag exactly matches `package.json`, confirms the checked-out commit is the tagged commit, generates a changelog from Git history, runs `bun run verify`, builds the web release, sets the Android version from the tag, builds a signed APK, and verifies its signature with `apksigner`. It publishes the web tarball, APK, `CHANGELOG.md`, and `SHA256SUMS`, then creates GitHub artifact attestations for the tarball, the APK, and the checksum file through OIDC. The decoded keystore is written with a restrictive umask and removed by an `EXIT` trap.

`bun.lock` is part of the release tarball, so the archived bundle carries the exact dependency resolution alongside the built `dist/`. `SHA256SUMS` covers the tarball, the APK, and `CHANGELOG.md`; each of the three is attested separately, so a consumer can verify any one artifact without unpacking the release.

All GitHub Actions are pinned to immutable commit SHAs, and each pin was checked against its upstream repository to sit in a tagged release: `actions/checkout` v7.0.1, `actions/setup-java` v6.0.1, `actions/upload-artifact` v7.0.1, `actions/attest` v4.2.2, `oven-sh/setup-bun` v2.2.0, and `android-actions/setup-android` v4.0.4 are the release tag commits themselves, while `actions/setup-node` (v7.0.0) and `gradle/actions` (v6.3.0) are commits inside those releases. `bun run config:check` re-verifies the 40-hex-character pin shape of every `uses:` in both workflows, so a tag reference or a branch name cannot reappear unnoticed. The workflow's Android-specific steps are exercised only by CI; see the limitations below.

### Known release-workflow limitations

- `@vitest/coverage-istanbul` declares an exact `vitest` peer of `5.0.2` while `package.json` ranges `vitest` as `^5.0.2`. The committed `bun.lock` resolves both to `5.0.2`, so the peer is satisfied today, but a future `bun install` that picks up vitest `5.x` can break coverage. Pin `vitest` exactly when regenerating the lockfile.
- `android/app/build.gradle` enables `lint { checkReleaseBuilds = true; abortOnError = true }`, so `assembleRelease` also runs Android lint and can fail on a lint regression that no web gate catches.
- The release workflow installs `platforms;android-36` and `build-tools;36.0.0` and then picks `apksigner` from the highest-numbered `build-tools` directory present on the runner. If the image ships a newer build-tools than the one that signed the APK, verification uses the newer tool; the signature scheme it checks is version-independent, but the selection is not pinned to the installed version.
- R8 runs in the release build (`minifyEnabled true`) with `shrinkResources false`, so code is minified and obfuscated while resources are not shrunk. `android/app/proguard-rules.pro` is the only place that can keep a manifest-declared component or a reflectively resolved plugin alive, and R8 failures therefore only surface on a real `assembleRelease` — which needs the signing secrets.
- Gradle is never invoked on a development machine for this project; the Android compile and the JVM unit tests are gated by the `android-unit-tests` CI job. `assembleRelease`, R8 shrinking, Android lint, and the instrumentation tests under `androidTestImplementation` therefore stay unexercised until CI or a release runs them, and `REQUEST_INSTALL_PACKAGES`, `USE_EXACT_ALARM`, and `USE_FULL_SCREEN_INTENT` still need physical-device and store-policy verification.

## Security notes

- Keep `bun.lock` committed and use frozen installs outside local development.
- Review high and critical audit findings before release; review lower-severity findings on a defined schedule.
- Currently accepted below-threshold advisory: one `moderate` in `uuid@7.0.3`, reached only through the dev-only path `@capacitor/cli > xcode > uuid` (macOS Xcode tooling that is not installed in CI and is not part of any shipped artifact). Re-check with `bun audit`; if `@capacitor/cli` ships a fixed `xcode` dependency, the finding should disappear.
- Keep the license allowlist explicit. Changes to licensing need maintainer review.
- Do not commit `.env` files, backup files, Android keys, or signing credentials.
- Do not put secrets in `VITE_*` variables; Vite embeds them in browser assets.
- Treat backups as sensitive local data.
- Keep GitHub Actions permissions minimal and protect the `release` environment used for Android signing and attestations.
- Deploy only over HTTPS. Service workers and notification permissions are unavailable or restricted on insecure origins, except browser-defined development exceptions.
- `.gitattributes` forces LF for every text type this repository uses, including `bun.lock` and the Android sources, so Windows checkouts with `core.autocrlf=true` cannot rewrite the lockfile or the Gradle and Java inputs.

## Technology

- React 18 and TypeScript
- Vite 8 and `vite-plugin-pwa`
- Tailwind CSS 3 and PostCSS
- React Router 7
- Dexie and Capacitor Filesystem
- Capacitor 8
- jsPDF and jsPDF AutoTable
- Vitest, Testing Library, and Istanbul coverage
- Biome

## License

Copyright (c) 2026 Sumon317. Released under the [MIT License](LICENSE).
