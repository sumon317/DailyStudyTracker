# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub's security advisory form for this repository: **Security -> Report a vulnerability**. That opens a private channel between you and the maintainer, and it is the only way to report something that is not yet fixed.

Include:

- what the problem is, and what an attacker gains from it,
- how to reproduce it - the app version, the platform (web, PWA or Android), and the steps,
- anything you have already tried.

You will get an acknowledgement within a few days, and an assessment of whether the report is accepted, within two weeks. If it is accepted, the maintainer will agree a disclosure date with you before anything is published.

There is no bug bounty for this project. It is maintained in the open as a hobby project, and the reward is a fix and a credit in the release notes unless you would rather stay anonymous.

## What is in scope

- The web app, the PWA and the Android app in this repository.
- The backup format, and the code that reads a backup file.
- The Android plugins under `android/app/src/main/java/com/sumon/studytracker/`.
- The release workflow in `.github/workflows/release.yml`.

## What is out of scope

- **The absence of encryption.** Study data is stored in the clear, on the device, by design. A backup file is plain JSON and anyone who can read it can read the notes inside it. This is documented in the README and it is not a vulnerability.
- **The absence of cloud sync or accounts.** There is no server to attack, and no authentication to bypass.
- **The absence of a signing key in the repository.** The release workflow builds a signed APK from secrets that are supplied at release time. The key is never committed, and the workflow fails rather than producing an unsigned artifact.
- **Findings that need an already-compromised device.** An attacker with a rooted phone or a malicious browser extension has already won.
- **Missing hardening that has no attacker-controlled input behind it.**

## What the maintainer will do

A confirmed vulnerability is fixed before the next release, and the fix ships with a version bump and a note in the changelog. Anything that could put a user's study data at risk - a backup import that writes outside its bounds, an import that accepts a payload it should reject - is treated as high priority.

## Dependencies

The dependency tree is audited in CI on every push, and the audit fails on high and critical advisories. The license allowlist is explicit and is checked in CI as well, so a dependency cannot quietly arrive with a license the project does not accept.

One moderate advisory is currently accepted and documented in the README: `uuid@7.0.3`, reached only through the development-only path `@capacitor/cli > xcode > uuid`. It is macOS Xcode tooling that is not installed in CI and is not part of any shipped artifact.

## Hardening notes for anyone auditing this project

The places worth reading first:

- `src/services/storage/validation.ts` - every value that comes out of a backup file passes through these validators. The bounds, the depth limit and the rejection of prototype-polluting keys live here.
- `src/services/storage/backup.ts` - the parsing of the backup format, including the legacy shapes that are still accepted.
- `src/services/storage/stores.ts` - the native file writes, which use a temporary file and an atomic rename, and quarantine a file they cannot parse rather than deleting it.
- `src/services/notificationService.ts` - the bridge to the native notification plugin.

The project takes the position that a restored backup is untrusted input, even though it usually comes from the user's own device.
