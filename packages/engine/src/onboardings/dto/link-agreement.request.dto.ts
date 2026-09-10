import { IsString, IsUUID } from 'class-validator';

/**
 * `POST /v1/onboardings/:id/agreements`. An operator names the exact published version to link,
 * never a family: which version an onboarding owes is a decision, and resolving a `key` here
 * would silently link whatever happened to be latest at the moment the call landed.
 */
export class LinkAgreementRequestDto {
  @IsString()
  @IsUUID()
  agreementId!: string;
}
