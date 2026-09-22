import { EncryptionPort } from './encryption.port';
import { EncryptionUnavailableError } from './errors/encryption-unavailable.error';

/**
 * A module-level holder for the active `EncryptionPort`, unavoidable because TypeORM evaluates
 * `@Column({ transformer })` at class definition time — long before Nest's injector exists — so
 * column transformers cannot receive the port through constructor injection. `EncryptionModule` calls
 * `setEncryptionPort` once at bootstrap and `clearEncryptionPort` on shutdown; every transformer
 * calls `requireEncryptionPort` lazily, per query.
 */
let activePort: EncryptionPort | undefined;

export function setEncryptionPort(port: EncryptionPort): void {
  activePort = port;
}

/**
 * Unbinds `port`, so a transformer reached after its application closed throws
 * `EncryptionUnavailableError` rather than using a service whose `DataSource` is gone. Takes the
 * port rather than clearing unconditionally: a process that closes one application after opening
 * another — every e2e suite that opens a second app — must not have the older one's shutdown
 * unbind the port the newer one is still serving.
 */
export function clearEncryptionPort(port: EncryptionPort): void {
  if (activePort === port) {
    activePort = undefined;
  }
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
