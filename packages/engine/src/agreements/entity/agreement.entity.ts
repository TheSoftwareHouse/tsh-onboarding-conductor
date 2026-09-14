import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { type AgreementType } from '../agreement.types';

/**
 * One published version of one agreement family. A family is identified by `key` —
 * `eu-b2c-terms` — and a version within it is monotonic from `1`; together they are unique, and
 * that unique index is also what serves the latest-version lookup a publish and an onboarding
 * start both make (`ORDER BY version DESC LIMIT 1` for a key).
 *
 * There is deliberately no `name`: `key` and `type` identify the family, and a display label
 * carried on a version row would drift between versions of one family. `type` is a property of
 * the family too — it is constant across its versions, and a publish under an existing `key`
 * with a different `type` is rejected.
 */
@Entity({ name: 'agreements' })
@Index('uq_agreements_key_version', ['key', 'version'], { unique: true })
export class AgreementEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 64 })
  type!: AgreementType;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
