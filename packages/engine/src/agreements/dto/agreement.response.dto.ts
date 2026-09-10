import { PaginatedMetaResponseDto } from '../../pagination';
import { type AgreementType } from '../agreement.types';
import type { AgreementEntity } from '../entity/agreement.entity';
import type { PublishedAgreement } from '../agreements.service';

/** One published version, as every agreement endpoint reports it. */
export type AgreementResponse = {
  id: string;
  key: string;
  type: AgreementType;
  version: number;
  publishedAt: string;
};

/**
 * What a publish reports back. `linkedOnboardings` counts only the links this publish actually
 * created — an onboarding already holding the new version is not counted and was not notified.
 */
export type PublishAgreementResponse = AgreementResponse & {
  linkedOnboardings: number;
};

/** One page of published versions. Mirrors the envelope every other paginated admin list uses. */
export type ListAgreementsResponse = {
  items: AgreementResponse[];
  meta: PaginatedMetaResponseDto;
};

/** The entity carries `publishedAt` as a `Date`; this is the one place it becomes ISO text. */
export function toAgreementResponse(agreement: AgreementEntity): AgreementResponse {
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
): PublishAgreementResponse {
  return {
    ...toAgreementResponse(published.agreement),
    linkedOnboardings: published.linkedOnboardings,
  };
}
