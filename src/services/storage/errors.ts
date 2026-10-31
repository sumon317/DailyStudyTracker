/**
 * The errors the storage layer raises.
 *
 * They are separate classes rather than one error with a flag, because the caller has to treat
 * them differently: corruption is quarantined and the user is told, while a payload this build
 * simply does not understand must be left alone.
 */

export class PersistenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PersistenceError';
    }
}

/**
 * Raised for a payload this build cannot interpret (for example a newer schema version).
 * It is deliberately distinct from corruption: the caller must not quarantine such a file.
 */
export class UnsupportedSchemaError extends PersistenceError {
    constructor(message: string) {
        super(message);
        this.name = 'UnsupportedSchemaError';
    }
}

/**
 * Aborts the current validation with a persistence error.
 *
 * The validators are a wall of assertions, so a failed check ends the walk rather than
 * returning a value the caller has to remember to test.
 */
export function fail(message: string): never {
    throw new PersistenceError(message);
}
