import { EncryptionPort } from './encryption.port';
import { EncryptionUnavailableError } from './errors/encryption-unavailable.error';

/**
 * A module-level holder for the active `EncryptionPort`, unavoidable because TypeORM evaluates
 * `@Column({ transformer })` at class definition time — long before Nest's injector exists — so
 * column transformers cannot receive the port through constructor injection. `EncryptionModule` calls
 * `setEncryptionPort` once at bootstrap; every transformer calls `requireEncryptionPort` lazily,
 * per query.
 */
let activePort: EncryptionPort | undefined;

export function setEncryptionPort(port: EncryptionPort): void {
  activePort = port;
}

/**
 * Throws `EncryptionUnavailableError` if called before `EncryptionModule` has initialised. Never
 * defaults to a pass-through implementation.
 */
export function requireEncryptionPort(): EncryptionPort {
  if (!activePort) {
    throw new EncryptionUnavailableError();
  }

  return activePort;
}
