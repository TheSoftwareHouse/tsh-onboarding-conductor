import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * The stored settings of one connector, keyed by its connector type. `settings` holds only the
 * keys an operator has actually set — anything absent falls back to the environment — and a
 * secret field's value is stored encrypted rather than as it was typed.
 */
@Entity({ name: 'connector_settings' })
export class ConnectorSettingEntity {
  @PrimaryColumn({ name: 'connector_type', type: 'varchar', length: 100 })
  connectorType!: string;

  @Column({ type: 'jsonb' })
  settings!: Record<string, string>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
