import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One opaque provider handle per `(onboarding, connector)`: the id a KYC provider assigned to
 * this onboarding's applicant. No image bytes, no identity data, no provider payload — just the
 * handle an adapter needs to re-derive its own prior work, and the reverse lookup an operator or
 * a callback assertion needs to go from a provider id back to the onboarding it belongs to.
 *
 * The composite primary key makes a write idempotent across a re-run — a provider's create-`409`
 * path re-derives the same applicant id and upserts the same row rather than conflicting. The
 * unique index on `(connectorId, applicantId)` is what makes the reverse lookup correct: a given
 * provider's applicant id resolves to exactly one onboarding.
 */
@Entity({ name: 'connector_applicant_references' })
@Index('uq_connector_applicant_references_connector_applicant', ['connectorId', 'applicantId'], {
  unique: true,
})
export class ConnectorApplicantReferenceEntity {
  @PrimaryColumn({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @PrimaryColumn({ name: 'connector_id', type: 'varchar', length: 64 })
  connectorId!: string;

  @Column({ name: 'applicant_id', type: 'varchar', length: 64 })
  applicantId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
