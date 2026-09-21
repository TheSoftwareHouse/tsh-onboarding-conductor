export interface EncryptionKey {
  /** The id written into every envelope this key produced. */
  id: string;
  createdAt: string;
  /**
   * The operator who added this key, as the bearer token identified them; `null` for a key the
   * engine provisioned itself — historical rows only, now that keys are created from the panel.
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
  progress: EncryptionProgress;
}
