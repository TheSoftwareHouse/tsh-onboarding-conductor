import { ApiProperty } from '@nestjs/swagger';
import {
  NOT_ACCEPTED_AGREEMENT_STATUS,
  type AgreementType,
  type OnboardingAgreementStatus,
} from '../../agreements/agreement.types';
import { AGREEMENT_TYPE_ENUM, ONBOARDING_AGREEMENT_STATUS_ENUM } from '../../openapi/api-enums';
import type { OnboardingAgreementSummary } from '../onboarding-agreements.repository';

/**
 * One agreement family an onboarding holds, as accepted-versus-latest plus the label that pairing
 * derives to. The repository reports the raw versions; naming the state is this layer's job, and
 * it is the same rule the `onboarding_agreement_statuses` view applies per family.
 */
export class OnboardingAgreementResponseDto {
  @ApiProperty({ maxLength: 100, description: 'The family.', example: 'eu-b2c-terms' })
  key!: string;

  @ApiProperty({ ...AGREEMENT_TYPE_ENUM })
  type!: AgreementType;

  @ApiProperty({
    format: 'uuid',
    description:
      'The id of the highest published version of the family: what the accept route takes.',
  })
  latestAgreementId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'The highest published version of the family.',
  })
  latestVersion!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    nullable: true,
    description: 'The highest version this onboarding accepted; null while it has accepted none.',
  })
  acceptedVersion!: number | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When `acceptedVersion` was accepted; null while nothing is.',
  })
  acceptedAt!: string | null;

  @ApiProperty({
    ...ONBOARDING_AGREEMENT_STATUS_ENUM,
    description:
      'This family alone: `not_accepted` with no accepted version, `outdated` when the accepted ' +
      'one is behind the latest, `current` otherwise.',
  })
  status!: OnboardingAgreementStatus;
}

/** Every family one onboarding holds. A family it was never linked to is simply absent. */
export class OnboardingAgreementsResponseDto {
  @ApiProperty({ format: 'uuid' })
  onboardingId!: string;

  @ApiProperty({
    type: () => OnboardingAgreementResponseDto,
    isArray: true,
    description:
      'Every family the onboarding holds, ordered by key. One it was never linked to is absent, ' +
      'and an onboarding holding none reads as an empty list.',
  })
  items!: OnboardingAgreementResponseDto[];
}

/** What a link call reports. `created` is false when the pair was already linked. */
export class LinkAgreementResponseDto {
  @ApiProperty({ format: 'uuid' })
  onboardingId!: string;

  @ApiProperty({ format: 'uuid', description: 'The published version now linked.' })
  agreementId!: string;

  @ApiProperty({ description: 'The family of the linked version.', example: 'eu-b2c-terms' })
  key!: string;

  @ApiProperty({ type: 'integer', minimum: 1, description: 'The linked version.' })
  version!: number;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether this call created the link. False when the pair was already linked, in which ' +
      'case nothing was written and no notification was sent.',
  })
  created!: boolean;
}

/** What an acceptance reports. `acceptedAt` is the first acceptance, not the replayed one. */
export class AcceptAgreementResponseDto {
  @ApiProperty({ format: 'uuid' })
  onboardingId!: string;

  @ApiProperty({ format: 'uuid', description: 'The published version accepted.' })
  agreementId!: string;

  @ApiProperty({ description: 'The family of the accepted version.', example: 'eu-b2c-terms' })
  key!: string;

  @ApiProperty({ type: 'integer', minimum: 1, description: 'The accepted version.' })
  version!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the version was first accepted; a repeated acceptance reports the original time.',
  })
  acceptedAt!: string | null;
}

export function toOnboardingAgreementsResponse(
  onboardingId: string,
  summaries: readonly OnboardingAgreementSummary[],
): OnboardingAgreementsResponseDto {
  return {
    onboardingId,
    items: summaries.map((summary) => ({
      key: summary.key,
      type: summary.type,
      latestAgreementId: summary.latestAgreementId,
      latestVersion: summary.latestVersion,
      acceptedVersion: summary.acceptedVersion,
      acceptedAt: summary.acceptedAt === null ? null : summary.acceptedAt.toISOString(),
      status: deriveAgreementStatus(summary),
    })),
  };
}

function deriveAgreementStatus(summary: OnboardingAgreementSummary): OnboardingAgreementStatus {
  if (summary.acceptedVersion === null) {
    return NOT_ACCEPTED_AGREEMENT_STATUS;
  }

  return summary.acceptedVersion < summary.latestVersion ? 'outdated' : 'current';
}
