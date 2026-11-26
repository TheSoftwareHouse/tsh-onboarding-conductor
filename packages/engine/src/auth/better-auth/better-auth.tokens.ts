/** The better-auth instance; `null` when `ADMIN_AUTH_ENABLED` is not `true`. */
export const BETTER_AUTH = Symbol('BETTER_AUTH');

/** The `pg` pool better-auth reads and writes through; `null` when admin auth is off. */
export const BETTER_AUTH_POOL = Symbol('BETTER_AUTH_POOL');
