import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { EncryptionKeyRotationInterval } from '../encryption-key-rotation';

/**
 * One data key that has protected — or still protects — `onboardings.context`. `wrapped_key` is
 * never the raw 32-byte key: it is base64(iv || authTag || key), sealed under the
 * key-encryption key (`ENCRYPTION_KEY`) with the row's own `id` as AAD, so a wrapped value copied
 * onto another row's id fails to unwrap.
 *
 * `deleted_at IS NULL` marks the single active key; the database enforces there is ever at most
 * one via `uq_encryption_keys_active` (migration `0024`), not application logic. That same row
 * carries the automatic-rotation schedule (`rotation_interval`, migration `0026`). Adding a key
 * soft-deletes the previous one — the row and its wrapped material are retained, never erased,
 * because rows written under an older key keep naming it until they are next written, which may be
 * never. A superseded key is read-only but live, not transitional.
 */
@Entity({ name: 'encryption_keys' })
export class EncryptionKeyEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'wrapped_key', type: 'text' })
  wrappedKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'created_by', type: 'varchar', length: 255, nullable: true })
  createdBy!: string | null;

  @Column({ name: 'activated_at', type: 'timestamptz' })
  activatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  /**
   * How often the engine rotates this key on its own, or `null` for no automatic rotation. Carried
   * on the key rather than in a settings row so the one row with `deleted_at IS NULL` holds the
   * whole of "encryption is on, and this is when it next rotates"; the next rotation is
   * `created_at` plus this interval (`encryption-key-rotation.ts`), so every rotation restarts the
   * countdown by creating a row, and a retired key's value is simply the schedule that was in
   * force while it was active.
   */
  @Column({ name: 'rotation_interval', type: 'varchar', length: 8, nullable: true })
  rotationInterval!: EncryptionKeyRotationInterval | null;

  /**
   * When an operator asked for every stored onboarding to be moved onto this key, or `null` when
   * none is outstanding. Set by `POST /v1/admin/encryption/reencryption`, cleared by the sweep
   * once nothing is left to move (migration `0027`).
   */
  @Column({ name: 'reencrypt_requested_at', type: 'timestamptz', nullable: true })
  reencryptRequestedAt!: Date | null;
}
