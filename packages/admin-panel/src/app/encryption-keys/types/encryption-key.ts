export interface EncryptionKey {
  /** The id written into every envelope this key produced. */
  id: string;
  createdAt: string;
  /**
   * The operator who added this key, as the bearer token identified them; `null` for the key the
   * engine provisions itself at first boot with nothing but `.env` — that distinction is the one
   * thing the list must not blur, since it is the difference between an automatic and an
   * operator-triggered rotation.
   */
  createdBy: string | null;
  activatedAt: string;
  /** When this key was superseded; `null` for the currently active key. */
  deletedAt: string | null;
  /** Whether this is the key `encrypt` currently uses. */
  active: boolean;
}

export interface ReEncryptionProgress {
  /** Onboarding contexts still naming a key other than the active one. */
  pending: number;
  /** Every onboarding context carrying an encryption envelope. */
  total: number;
}
