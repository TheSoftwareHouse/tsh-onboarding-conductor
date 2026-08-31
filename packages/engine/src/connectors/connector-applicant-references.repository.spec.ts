import { getMetadataArgsStorage } from 'typeorm';
import { ConnectorApplicantReferencesRepository } from './connector-applicant-references.repository';
import { ConnectorApplicantReferenceEntity } from './entity/connector-applicant-reference.entity';

describe('ConnectorApplicantReferencesRepository', () => {
  it('inserts a first save', async () => {
    const repository = { upsert: jest.fn(), findOne: jest.fn() };
    const applicantReferencesRepository = new ConnectorApplicantReferencesRepository(
      repository as never,
    );

    await applicantReferencesRepository.save({
      onboardingId: 'onboarding-1',
      connectorId: 'sumsub_kyc',
      applicantId: 'applicant-1',
    });

    expect(repository.upsert).toHaveBeenCalledWith(
      { onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc', applicantId: 'applicant-1' },
      ['onboardingId', 'connectorId'],
    );
  });

  it('overwrites rather than throwing on a second save for the same onboarding and connector', async () => {
    const repository = { upsert: jest.fn(), findOne: jest.fn() };
    const applicantReferencesRepository = new ConnectorApplicantReferencesRepository(
      repository as never,
    );

    await applicantReferencesRepository.save({
      onboardingId: 'onboarding-1',
      connectorId: 'sumsub_kyc',
      applicantId: 'applicant-1',
    });
    await applicantReferencesRepository.save({
      onboardingId: 'onboarding-1',
      connectorId: 'sumsub_kyc',
      applicantId: 'applicant-2',
    });

    expect(repository.upsert).toHaveBeenCalledTimes(2);
    expect(repository.upsert).toHaveBeenLastCalledWith(
      { onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc', applicantId: 'applicant-2' },
      ['onboardingId', 'connectorId'],
    );
  });

  it('returns the stored applicant id for a known onboarding and connector', async () => {
    const repository = {
      upsert: jest.fn(),
      findOne: jest.fn().mockResolvedValue({
        onboardingId: 'onboarding-1',
        connectorId: 'sumsub_kyc',
        applicantId: 'applicant-1',
      }),
    };
    const applicantReferencesRepository = new ConnectorApplicantReferencesRepository(
      repository as never,
    );

    await expect(
      applicantReferencesRepository.findByOnboarding({
        onboardingId: 'onboarding-1',
        connectorId: 'sumsub_kyc',
      }),
    ).resolves.toBe('applicant-1');
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' },
    });
  });

  it('returns undefined from findByOnboarding for an unknown onboarding', async () => {
    const repository = { upsert: jest.fn(), findOne: jest.fn().mockResolvedValue(null) };
    const applicantReferencesRepository = new ConnectorApplicantReferencesRepository(
      repository as never,
    );

    await expect(
      applicantReferencesRepository.findByOnboarding({
        onboardingId: 'unknown',
        connectorId: 'sumsub_kyc',
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves the onboarding id for a known applicant id', async () => {
    const repository = {
      upsert: jest.fn(),
      findOne: jest.fn().mockResolvedValue({
        onboardingId: 'onboarding-1',
        connectorId: 'sumsub_kyc',
        applicantId: 'applicant-1',
      }),
    };
    const applicantReferencesRepository = new ConnectorApplicantReferencesRepository(
      repository as never,
    );

    await expect(
      applicantReferencesRepository.findOnboardingId({
        connectorId: 'sumsub_kyc',
        applicantId: 'applicant-1',
      }),
    ).resolves.toBe('onboarding-1');
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { connectorId: 'sumsub_kyc', applicantId: 'applicant-1' },
    });
  });

  it('returns undefined from findOnboardingId for an unknown applicant id', async () => {
    const repository = { upsert: jest.fn(), findOne: jest.fn().mockResolvedValue(null) };
    const applicantReferencesRepository = new ConnectorApplicantReferencesRepository(
      repository as never,
    );

    await expect(
      applicantReferencesRepository.findOnboardingId({
        connectorId: 'sumsub_kyc',
        applicantId: 'unknown',
      }),
    ).resolves.toBeUndefined();
  });

  it('carries exactly the four pinned columns and no identity data', () => {
    const columnNames = getMetadataArgsStorage()
      .columns.filter((column) => column.target === ConnectorApplicantReferenceEntity)
      .map((column) => column.propertyName)
      .sort();

    expect(columnNames).toEqual(['applicantId', 'connectorId', 'createdAt', 'onboardingId'].sort());
  });
});
