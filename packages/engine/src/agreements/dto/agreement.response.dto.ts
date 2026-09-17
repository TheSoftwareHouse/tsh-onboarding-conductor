import { ApiProperty } from '@nestjs/swagger';
import { AGREEMENT_TYPE_ENUM } from '../../openapi/api-enums';
import { PaginatedMetaResponseDto } from '../../pagination';
import { type AgreementType } from '../agreement.types';
import type { AgreementEntity } from '../entity/agreement.entity';
import type { PublishedAgreement } from '../agreements.service';

/** One published version, as every agreement endpoint reports it. */
export class AgreementResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: "The version's own id: what a link, and the accept route, name.",
  })
  id!: string;

  @ApiProperty({
    maxLength: 100,
    description: 'The family this is a version of.',
    example: 'eu-b2c-terms',
  })
  key!: string;

  @ApiProperty({ ...AGREEMENT_TYPE_ENUM })
  type!: AgreementType;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'Monotonic within the family, from 1. The engine derives it; nobody submits it.',
  })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  publishedAt!: string;
}

/**
 * What a publish reports back. `linkedOnboardings` counts only the links this publish actually
 * created — an onboarding already holding the new version is not counted and was not notified.
 */
export class PublishAgreementResponseDto extends AgreementResponseDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description:
      'Onboardings this publish linked the new version to as pending, each of which was ' +
      'notified. One already holding the version is neither counted nor notified.',
  })
  linkedOnboardings!: number;
}

/** One page of published versions. Mirrors the envelope every other paginated admin list uses. */
export class ListAgreementsResponseDto {
  @ApiProperty({ type: () => AgreementResponseDto, isArray: true })
  items!: AgreementResponseDto[];

  @ApiProperty({ type: () => PaginatedMetaResponseDto })
  meta!: PaginatedMetaResponseDto;
}

/** The entity carries `publishedAt` as a `Date`; this is the one place it becomes ISO text. */
export function toAgreementResponse(agreement: AgreementEntity): AgreementResponseDto {
  return {
    id: agreement.id,
    key: agreement.key,
    type: agreement.type,
    version: agreement.version,
    publishedAt: agreement.publishedAt.toISOString(),
  };
}

export function toPublishAgreementResponse(
  published: PublishedAgreement,
): PublishAgreementResponseDto {
  return {
    ...toAgreementResponse(published.agreement),
    linkedOnboardings: published.linkedOnboardings,
  };
}
