import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectorApplicantReferenceEntity } from './entity/connector-applicant-reference.entity';

export type ConnectorApplicantReferenceSaveInput = {
  readonly onboardingId: string;
  readonly connectorId: string;
  readonly applicantId: string;
};

export type ConnectorApplicantReferenceByOnboardingInput = {
  readonly onboardingId: string;
  readonly connectorId: string;
};

export type ConnectorApplicantReferenceByApplicantInput = {
  readonly connectorId: string;
  readonly applicantId: string;
};

/**
 * Moves the provider applicant id in and out of Postgres. `save` upserts on the composite
 * primary key so a re-run through a provider's create-`409` path rewrites the same row rather
 * than conflicting. The `find*` methods return `undefined` and never throw, matching the
 * resolver convention elsewhere in this module.
 */
@Injectable()
export class ConnectorApplicantReferencesRepository {
  constructor(
    @InjectRepository(ConnectorApplicantReferenceEntity)
    private readonly repository: Repository<ConnectorApplicantReferenceEntity>,
  ) {}

  async save(input: ConnectorApplicantReferenceSaveInput): Promise<void> {
    await this.repository.upsert(
      {
        onboardingId: input.onboardingId,
        connectorId: input.connectorId,
        applicantId: input.applicantId,
      },
      ['onboardingId', 'connectorId'],
    );
  }

  async findByOnboarding(
    input: ConnectorApplicantReferenceByOnboardingInput,
  ): Promise<string | undefined> {
    const reference = await this.repository.findOne({
      where: { onboardingId: input.onboardingId, connectorId: input.connectorId },
    });

    return reference?.applicantId;
  }

  async findOnboardingId(
    input: ConnectorApplicantReferenceByApplicantInput,
  ): Promise<string | undefined> {
    const reference = await this.repository.findOne({
      where: { connectorId: input.connectorId, applicantId: input.applicantId },
    });

    return reference?.onboardingId;
  }
}
