import { Capacitor } from '@capacitor/core';

/**
 * The constants every storage layer agrees on.
 *
 * The keys, the limits and the schema version are the contract between the app, the backup
 * format and the native plugin. They live in one place so a limit cannot be raised in the
 * validator while the writer still enforces the old one.
 */

/** The version of the backup envelope this build reads and writes. */
export const BACKUP_SCHEMA_VERSION = 1;

/** The file the native platform keeps its data in. */
export const STORAGE_FILE = 'study-tracker-data.json';

/** Legacy storage keys, kept so an older install is still readable. */
export const RECURRING_KEY = '__recurring_subjects';
export const TODOS_KEY = '__global_todos';
export const FOCUS_ALARMS_KEY = '__focus_alarms';
export const SETTINGS_KEY = '__settings';

export const LEGACY_FOCUS_KEYS = ['focusAlarms', '__focusAlarms'];
export const FOCUS_STORAGE_KEY = 'focusAlarms';
export const LEGACY_SETTINGS_KEYS = ['settings', '__backup_settings'];
export const THEME_STORAGE_KEY = 'theme';
export const ADAPTIVE_COLOR_STORAGE_KEY = 'adaptive-color';

/** The metadata table keys the global sections are stored under. */
export const METADATA_RECURRING_KEY = 'recurringSubjects';
export const METADATA_TODOS_KEY = 'todos';
export const METADATA_FOCUS_KEY = 'focusAlarms';
export const METADATA_SETTINGS_KEY = 'settings';

/**
 * The bounds a stored record has to stay inside.
 *
 * They are a floor on what the app can hold and a ceiling on what it will read back. A file
 * that exceeds them cannot be loaded, so the writer refuses to create one.
 */
export const MAX_DAYS = 10000;
export const MAX_ITEMS = 2000;
export const MAX_SUBJECTS = 1000;
export const MAX_NESTED_ITEMS = 1000;
export const MAX_STRING_LENGTH = 10000;
export const MAX_DEPTH = 32;
export const MAX_ID = Number.MAX_SAFE_INTEGER;
export const MAX_MINUTES = 1440;
export const MAX_NATIVE_ID = 2147483647;

/**
 * Reserved (non day) keys a legacy native map may carry: recurring, todos, focus (2 spellings)
 * and settings (2 spellings). Used to reject pathologically large maps before any day is parsed.
 */
export const MAX_LEGACY_MAP_KEYS = MAX_DAYS + 8;

/**
 * Upper bound for a restore payload, in bytes.
 *
 * This is an import-side memory guard, not a bound the store is kept under: the theoretical
 * maximum export (MAX_DAYS days each holding the maximum subjects, checklist, quality and
 * error records at the maximum string length) is orders of magnitude larger than any cap a
 * phone could read into memory, so no cap can be above it. It is sized instead to stay above
 * what a *realistically* full store serialises to - a day limit's worth of days with a normal
 * payload is a couple of dozen MiB - and the restore-size test pins that headroom, so lowering
 * it past a store the app can actually hold would fail the suite rather than silently make the
 * user's own backup unrestorable.
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/**
 * Timestamp assigned to records that predate `DayData.updatedAt`. It must be deterministic:
 * a fabricated "now" would be re-generated on every read, so an explicit restore could lose to
 * the read timestamp instead of to the data's real age.
 */
export const LEGACY_UPDATED_AT = '1970-01-01T00:00:00.000Z';

/** The themes a stored settings record may name. */
export const THEMES = new Set(['light', 'dark', 'auto', 'material-light', 'material-dark', 'adaptive']);

/**
 * Keys that would let a payload reach `Object.prototype` or a constructor.
 *
 * A restored file is untrusted input, so a key like `__proto__` is rejected before anything
 * walks the value.
 */
export const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Whether the app is running against the native platform. */
export const isNative = Capacitor.isNativePlatform();
