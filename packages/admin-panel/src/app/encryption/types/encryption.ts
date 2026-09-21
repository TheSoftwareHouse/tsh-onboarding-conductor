export interface EncryptionKey {
  /** The id written into every envelope this key produced. */
  id: string;
  createdAt: string;
  /**
   * The operator who turned encryption on or added this key, as the bearer token identified them,
   * or the engine's unknown-actor marker when admin authentication is off. `null` only for a row
   * inserted outside the API: every key the engine creates records who asked for it.
   */
  createdBy: string | null;
  /** When the key became — or, while `pendingActivation`, will become — the one new writes use. */
  activatedAt: string;
  /** When this key was retired; `null` while it is still part of the ring. */
  deletedAt: string | null;
  /** Whether this is the key encrypting new writes right now. */
  active: boolean;
  /**
   * Added but not yet active: the engine holds a new key back for a grace window so every engine
   * process learns of it before any of them writes with it.
   */
  pendingActivation: boolean;
}

/**
 * How often the engine rotates the key on its own. A closed set the engine defines and this panel
 * only renders — `EncryptionKeyRotationInterval` in `engine.openapi.json`.
 */
export type EncryptionKeyRotationInterval = '48h' | '96h' | '1w' | '2w' | '1mo';

export interface EncryptionRotation {
  /** The schedule in force, or `null` when the engine rotates only on request. */
  interval: EncryptionKeyRotationInterval | null;
  /**
   * When the next automatic rotation falls due — the active key's creation plus `interval`. Null
   * whenever `interval` is, and in the past for a schedule that has come due but whose rotation
   * the engine has not run yet.
   */
  nextRotationAt: string | null;
}

export interface EncryptionProgress {
  /**
   * Onboardings the background sweep still has to move: rows not yet on the active key while
   * encryption is on, rows still encrypted while it is off.
   */
  pending: number;
  /** Every stored onboarding. */
  total: number;
}

export interface EncryptionState {
  /** The target state the operator chose — a key row exists that has not been retired. */
  enabled: boolean;
  /**
   * Whether the engine process has its key-encryption key (`ENCRYPTION_KEY`) configured. Without
   * it encryption can be neither turned on nor rotated.
   */
  keyConfigured: boolean;
  /** Full history, most recent first. */
  keys: EncryptionKey[];
  /** The automatic-rotation schedule the active key carries; empty while encryption is off. */
  rotation: EncryptionRotation;
  progress: EncryptionProgress;
}
