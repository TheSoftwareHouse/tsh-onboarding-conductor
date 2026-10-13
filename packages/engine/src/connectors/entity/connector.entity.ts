import type { ConnectorType } from '@tsh/ddl-schema';
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * One connector, keyed by the `id` its adapter declares — `twilio_sms_otp`, `smtp` — which is
 * also the value a workflow step's connector declaration names. `type` classifies it along the
 * same axis a workflow's `type` uses, so an operator can ask for every `messaging` connector
 * without knowing which providers implement it.
 *
 * A row exists only once an operator has written settings; the configurable connectors an
 * operator *could* configure come from the adapter collection, not from this table. `type` is
 * therefore stamped from the adapter on write, so a stored row still describes itself when read
 * directly from the database.
 *
 * `settings` is plain `jsonb` — confidentiality at rest is the deployment database's
 * responsibility (an encrypted volume or a managed instance's disk encryption), not the
 * engine's. There is no encryption or decryption of this column anywhere in the engine.
 */
@Entity({ name: 'connectors' })
export class ConnectorEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: ConnectorType;

  @Column({ type: 'jsonb' })
  settings!: Record<string, string>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'varchar', length: 255, nullable: true })
  updatedBy!: string | null;
}
