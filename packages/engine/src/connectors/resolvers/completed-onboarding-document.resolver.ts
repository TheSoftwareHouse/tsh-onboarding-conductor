import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Not, Repository } from 'typeorm';
import { OnboardingDocumentEntity } from '../../onboardings/entity/onboarding-document.entity';

export type CompletedOnboardingDocumentResolution = {
  readonly finalObjectKey: string;
  readonly verifiedEtag: string;
  readonly verifiedSizeBytes: number;
};

export type CompletedOnboardingDocumentResolutionInput = {
  readonly documentId: string;
  readonly onboardingId: string;
  readonly sourceField: string;
};

/**
 * Deliberately not scoped to a step. A connector may read a `file` field written by an earlier
 * step — the DDL's guaranteed-predecessor rule exists to permit exactly that, and `sumsub-kyc`
 * relies on it — so matching the executing step would reject every cross-step document. Nothing
 * is lost: field names are unique across a whole workflow (enforced at load), so `fieldName`
 * already pins the step, and `onboardingId` still confines the lookup to one customer.
 */
@Injectable()
export class CompletedOnboardingDocumentResolver {
  constructor(
    @InjectRepository(OnboardingDocumentEntity)
    private readonly repository: Repository<OnboardingDocumentEntity>,
  ) {}

  async resolve(
    input: CompletedOnboardingDocumentResolutionInput,
  ): Promise<CompletedOnboardingDocumentResolution | undefined> {
    if (!this.isNonEmptyString(input.documentId) || !this.isNonEmptyString(input.onboardingId)) {
      return undefined;
    }

    const document = await this.repository.findOne({
      where: {
        id: input.documentId,
        onboardingId: input.onboardingId,
        fieldName: input.sourceField,
        status: 'completed',
        finalObjectKey: Not(IsNull()),
        verifiedEtag: Not(IsNull()),
        verifiedSizeBytes: MoreThan(0),
      },
    });

    if (!document) {
      return undefined;
    }

    const finalObjectKey = document.finalObjectKey?.trim();
    const verifiedEtag = document.verifiedEtag?.trim();
    const verifiedSizeBytes = document.verifiedSizeBytes;

    if (
      !this.isNonEmptyString(finalObjectKey) ||
      !this.isNonEmptyString(verifiedEtag) ||
      typeof verifiedSizeBytes !== 'number' ||
      !Number.isSafeInteger(verifiedSizeBytes) ||
      verifiedSizeBytes <= 0
    ) {
      return undefined;
    }

    return {
      finalObjectKey,
      verifiedEtag,
      verifiedSizeBytes,
    };
  }

  private isNonEmptyString(value: string | undefined): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
