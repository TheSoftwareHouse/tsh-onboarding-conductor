import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * One data key that has protected — or still protects — `onboardings.context`. `wrapped_key` is
 * never the raw 32-byte key: it is base64(iv || authTag || key), sealed under the
 * key-encryption key (`ENCRYPTION_KEY`) with the row's own `id` as AAD, so a wrapped value copied
 * onto another row's id fails to unwrap.
 *
 * `deleted_at IS NULL` marks the single active key; the database enforces there is ever at most
 * one via `uq_encryption_keys_active` (migration `0024`), not application logic. Adding a key
 * soft-deletes the previous one — the row and its wrapped material are retained, never erased, so
 * rows still on an older key remain decryptable while the sweep moves them onto the new one.
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
}
