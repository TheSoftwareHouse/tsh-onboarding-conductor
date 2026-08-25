import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * One connector type's operator-supplied credentials, keyed by `connector_type`.
 * `settings` is plain `jsonb` — confidentiality at rest is the deployment database's
 * responsibility (an encrypted volume or a managed instance's disk encryption), not
 * the engine's. There is no encryption or decryption of this column anywhere in the
 * engine.
 */
@Entity({ name: 'connector_settings' })
export class ConnectorSettingEntity {
  @PrimaryColumn({ name: 'connector_type', type: 'varchar', length: 64 })
  connectorType!: string;

  @Column({ type: 'jsonb' })
  settings!: Record<string, string>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'varchar', length: 255, nullable: true })
  updatedBy!: string | null;
}
