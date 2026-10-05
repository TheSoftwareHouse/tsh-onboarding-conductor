import { Logger } from '@nestjs/common';
import { SumsubKycConnector } from './sumsub-kyc.connector';
import {
  SumsubCallbackDigestAlgorithmMismatchError,
  SumsubKycProvider,
  SumsubLevelDocSetMismatchError,
  SumsubLevelNotFoundError,
  SumsubLevelQuestionnaireMissingError,
} from './sumsub-kyc/sumsub-kyc.provider';
import { ConnectorCallbackAlreadyAppliedError } from '../../errors/connector-callback-already-applied.error';
import { KycConfigInvalidError } from './kyc/kyc-config';
import { SumsubOutcomeUnrecognisedStateError } from './sumsub-kyc/sumsub-outcome';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';
import type {
  ConnectorCallbackMappingInput,
  ConnectorExecutionInput,
} from '../../ports/connector-adapter.port';

const VALID_DOCUMENT = {
  payloadField: 'idFrontDocumentId',
  idDocSetType: 'IDENTITY',
  idDocType: 'ID_CARD',
  idDocSubType: 'FRONT_SIDE',
  country: 'POL',
};

const VALID_SECOND_DOCUMENT = {
  payloadField: 'selfieDocumentId',
  idDocSetType: 'SELFIE',
  idDocType: 'SELFIE',
  country: 'POL',
};

const VALID_CONFIG: Readonly<Record<string, unknown>> = {
  levelName: 'individual-standard-v2',
  sourceKey: 'sumsub',
  questionnaireDefinitionId: 'onboardingQuestionnaire',
  documents: [VALID_DOCUMENT],
  questionnairePathMap: {
    purposeOfAccount: 'purpose.accountPurpose',
  },
  maxAttemptsPerDocSet: 3,
};

const VALID_PAYLOAD: Readonly<Record<string, unknown>> = {
  firstName: 'Jan',
  lastName: 'Kowalski',
  dateOfBirth: '1990-01-01',
  nationality: 'PL',
  country: 'PL',
  street: 'Main Street 1',
  town: 'Warsaw',
  postCode: '00-001',
  idFrontDocumentId: 'document-1',
  purposeOfAccount: 'savings',
};

const createInput = (
  overrides: {
    config?: Readonly<Record<string, unknown>>;
    payload?: Readonly<Record<string, unknown>>;
    payloadFieldSources?: Readonly<Record<string, string>>;
  } = {},
): ConnectorExecutionInput => ({
  declaration: { order: 1, config: overrides.config ?? VALID_CONFIG },
  execution: { onboardingId: 'onboarding-1', stepName: 'kyc' },
  context: {},
  payload: overrides.payload ?? VALID_PAYLOAD,
  payloadFieldSources: overrides.payloadFieldSources ?? {},
});

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';

const matchingLevel = {
  name: 'individual-standard-v2',
  docSets: [
    { idDocSetType: 'APPLICANT_DATA' },
    { idDocSetType: 'IDENTITY' },
    { idDocSetType: 'QUESTIONNAIRE' },
  ],
};

const EXPECTED_DIGEST_ALG = 'HMAC_SHA256_HEX';

const VALID_CALLBACK_HEADERS: Readonly<Record<string, string | undefined>> = {
  'x-payload-digest-alg': EXPECTED_DIGEST_ALG,
};

const createCallbackBody = (overrides: Readonly<Record<string, unknown>> = {}): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      type: 'applicantReviewed',
      externalUserId: ONBOARDING_ID,
      applicantId: 'applicant-1',
      ...overrides,
    }),
  );

const createCallbackInput = (
  overrides: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string | undefined>> = VALID_CALLBACK_HEADERS,
): ConnectorCallbackMappingInput => ({
  rawBody: createCallbackBody(overrides),
  headers,
});

const IDENTITY_FIELD_MAPPING: Readonly<Record<string, string>> = {
  firstName: 'firstName',
  lastName: 'lastName',
  dateOfBirth: 'dateOfBirth',
  nationality: 'nationality',
  country: 'country',
  street: 'street',
  town: 'town',
  postCode: 'postCode',
};

const matchingConnectorDeclaration = {
  id: 'sumsub_kyc',
  order: 1,
  config: VALID_CONFIG,
  fieldMapping: IDENTITY_FIELD_MAPPING,
};

const matchingOnboarding = {
  id: ONBOARDING_ID,
  workflowId: 'workflow-1',
  workflowVersion: 1,
  currentStep: 'kyc',
  context: VALID_PAYLOAD,
};

const createDeps = () => {
  const sumsubClient = {
    findLevel: jest.fn().mockResolvedValue(matchingLevel),
    createApplicant: jest.fn().mockResolvedValue('applicant-1'),
    uploadIdDoc: jest.fn().mockResolvedValue('image-1'),
    submitQuestionnaire: jest.fn().mockResolvedValue(undefined),
    finalizeSubmission: jest.fn().mockResolvedValue(undefined),
    findApplicantStatus: jest.fn().mockResolvedValue({
      reviewStatus: 'completed',
      reviewResult: { reviewAnswer: 'GREEN' },
    }),
    findApplicant: jest.fn().mockResolvedValue({ lastName: 'Kowalski', dob: '1990-01-01' }),
    findAmlCase: jest.fn().mockResolvedValue({ hits: [] }),
    findRequiredIdDocsStatus: jest.fn().mockResolvedValue({}),
    resetStep: jest.fn().mockResolvedValue(undefined),
  };
  const connectorSettingsService = {
    resolve: jest.fn().mockResolvedValue({
      get: (key: string) =>
        key === 'appToken' ? 'app-token-1' : key === 'secretKey' ? 'secret-key-1' : undefined,
    }),
  };
  const documentResolver = {
    resolve: jest.fn().mockResolvedValue({
      // `DocumentUploadService.buildFinalObjectKey` always ends in the literal segment `final`,
      // never the documentId — this fixture mirrors that shape.
      finalObjectKey: 'onboardings/onboarding-1/document-1/final',
      verifiedEtag: '"etag-1"',
      verifiedSizeBytes: 128,
      contentType: 'image/png',
    }),
  };
  const objectStoragePort = {
    readObject: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
    deleteStagedObject: jest.fn(),
  };
  const awaitingCallbackConnectorResolver = {
    findConnector: jest.fn().mockResolvedValue({
      connectorOrder: 1,
      onboarding: matchingOnboarding,
      connector: matchingConnectorDeclaration,
    }),
  };

  return {
    sumsubClient,
    connectorSettingsService,
    documentResolver,
    objectStoragePort,
    awaitingCallbackConnectorResolver,
  };
};

const createConnector = (deps: ReturnType<typeof createDeps>) =>
  new SumsubKycConnector(
    new SumsubKycProvider(deps.sumsubClient as never),
    deps.connectorSettingsService as never,
    deps.documentResolver as never,
    deps.objectStoragePort as never,
    deps.awaitingCallbackConnectorResolver as never,
  );

describe('SumsubKycConnector', () => {
  describe('an applicant-supplied document country', () => {
    const COUNTRY_FIELD_DOCUMENT = (() => {
      const document: Record<string, unknown> = { ...VALID_DOCUMENT };
      delete document.country;
      return { ...document, countryField: 'documentIssuingCountry' };
    })();

    const countryFieldInput = (documentIssuingCountry: unknown) =>
      createInput({
        config: { ...VALID_CONFIG, documents: [COUNTRY_FIELD_DOCUMENT] },
        payload: { ...VALID_PAYLOAD, documentIssuingCountry },
      });

    it.each([
      ['an alpha-2 code', 'FR', 'FRA'],
      ['a lowercase code', 'fr', 'FRA'],
      ['a padded code', '  FR  ', 'FRA'],
    ])('converts %s to alpha-3 in the upload metadata', async (_label, declared, expected) => {
      const deps = createDeps();
      const connector = createConnector(deps);

      await connector.execute(countryFieldInput(declared));

      expect(deps.sumsubClient.uploadIdDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ metadata: expect.objectContaining({ country: expected }) }),
      );
    });

    it.each([
      ['missing', undefined],
      ['blank', '   '],
      ['not a string', 42],
      ['not an assigned ISO code', 'XX'],
    ])('refuses a %s issuing country before creating the applicant', async (_label, declared) => {
      const deps = createDeps();
      const connector = createConnector(deps);

      await expect(connector.execute(countryFieldInput(declared))).rejects.toThrow();

      // The whole point of resolving up front: a bad country must not leave an orphan applicant.
      expect(deps.sumsubClient.createApplicant).not.toHaveBeenCalled();
      expect(deps.sumsubClient.uploadIdDoc).not.toHaveBeenCalled();
    });

    it('still honours a statically configured country', async () => {
      const deps = createDeps();
      const connector = createConnector(deps);

      await connector.execute(createInput());

      expect(deps.sumsubClient.uploadIdDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ metadata: expect.objectContaining({ country: 'POL' }) }),
      );
    });
  });

  describe('validateDeclaration', () => {
    const declaration = (config: Record<string, unknown>, fieldMapping: Record<string, string>) =>
      ({
        name: 'sumsub_kyc',
        id: 'sumsub_kyc',
        type: 'kyc',
        canReject: false,
        async: true,
        order: 1,
        fieldMapping,
        config,
      }) as never;

    it('accepts a declaration whose document keys are all mapped', () => {
      const connector = createConnector(createDeps());

      expect(() =>
        connector.validateDeclaration(
          declaration(VALID_CONFIG, { idFrontDocumentId: 'identityDocument' }),
        ),
      ).not.toThrow();
    });

    it.each([
      ['payloadField', { ...VALID_DOCUMENT }, {}],
      [
        'countryField',
        (() => {
          const document: Record<string, unknown> = { ...VALID_DOCUMENT };
          delete document.country;
          return { ...document, countryField: 'documentIssuingCountry' };
        })(),
        { idFrontDocumentId: 'identityDocument' },
      ],
    ])('fails startup when %s is missing from fieldMapping', (_label, document, fieldMapping) => {
      const connector = createConnector(createDeps());

      expect(() =>
        connector.validateDeclaration(
          declaration({ ...VALID_CONFIG, documents: [document] }, fieldMapping),
        ),
      ).toThrow(KycConfigInvalidError);
    });
  });

  it('returns accepted() — never pending() — on a full successful submission', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    const result = await connector.execute(createInput());

    expect(result.isAccepted()).toBe(true);
    expect(result.isPending()).toBe(false);
    expect(result).toEqual(ConnectorExecutionResult.accepted({ providerReference: 'applicant-1' }));
  });

  it('sends externalUserId equal to the onboarding id when creating the applicant', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    await connector.execute(createInput());

    expect(deps.sumsubClient.createApplicant).toHaveBeenCalledWith(
      { appToken: 'app-token-1', secretKey: 'secret-key-1' },
      'individual-standard-v2',
      expect.objectContaining({ externalUserId: 'onboarding-1' }),
    );
  });

  it('includes the configured sourceKey in the createApplicant body', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    await connector.execute(createInput());

    expect(deps.sumsubClient.createApplicant).toHaveBeenCalledWith(
      { appToken: 'app-token-1', secretKey: 'secret-key-1' },
      'individual-standard-v2',
      expect.objectContaining({ sourceKey: 'sumsub' }),
    );
  });

  it('reaches the same applicant id on a re-run, because createApplicant resolves the existing one', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    await connector.execute(createInput());
    await connector.execute(createInput());

    expect(deps.sumsubClient.createApplicant).toHaveBeenCalledTimes(2);
    expect(deps.sumsubClient.createApplicant).toHaveBeenNthCalledWith(
      2,
      { appToken: 'app-token-1', secretKey: 'secret-key-1' },
      'individual-standard-v2',
      expect.objectContaining({ externalUserId: 'onboarding-1' }),
    );
  });

  it('drives the upload count from configuration — a two-document config issues two uploads', async () => {
    const deps = createDeps();
    deps.sumsubClient.findLevel.mockResolvedValue({
      name: 'individual-standard-v2',
      docSets: [
        { idDocSetType: 'IDENTITY' },
        { idDocSetType: 'SELFIE' },
        { idDocSetType: 'QUESTIONNAIRE' },
      ],
    });
    const connector = createConnector(deps);
    const input = createInput({
      config: { ...VALID_CONFIG, documents: [VALID_DOCUMENT, VALID_SECOND_DOCUMENT] },
      payload: { ...VALID_PAYLOAD, selfieDocumentId: 'document-2' },
    });

    await connector.execute(input);

    expect(deps.sumsubClient.uploadIdDoc).toHaveBeenCalledTimes(2);
  });

  it('calls readObject with the resolved etag and verifiedSizeBytes', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    await connector.execute(createInput());

    expect(deps.objectStoragePort.readObject).toHaveBeenCalledWith({
      objectKey: 'onboardings/onboarding-1/document-1/final',
      expectedEtag: '"etag-1"',
      maxBytes: 128,
    });
  });

  it('uses the documentId as the upload filename, not the trailing "final" path segment', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    await connector.execute(createInput());

    expect(deps.sumsubClient.uploadIdDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileName: 'document-1' }),
    );
  });

  it('returns invalid() when a configured document fails to resolve', async () => {
    const deps = createDeps();
    deps.documentResolver.resolve.mockResolvedValueOnce(undefined);
    const connector = createConnector(deps);

    const result = await connector.execute(createInput());

    expect(result).toEqual(ConnectorExecutionResult.invalid());
    expect(deps.sumsubClient.createApplicant).not.toHaveBeenCalled();
    expect(deps.sumsubClient.uploadIdDoc).not.toHaveBeenCalled();
  });

  it('throws when finalizeSubmission reports missing docSets', async () => {
    const deps = createDeps();
    const missingDocSetsError = new Error('missing docSets IDENTITY');
    deps.sumsubClient.finalizeSubmission.mockRejectedValueOnce(missingDocSetsError);
    const connector = createConnector(deps);

    await expect(connector.execute(createInput())).rejects.toThrow(missingDocSetsError);
  });

  describe('the level drift check', () => {
    it('runs after the documents are read, and still before createApplicant', async () => {
      const deps = createDeps();
      const connector = createConnector(deps);
      const callOrder: string[] = [];
      deps.objectStoragePort.readObject.mockImplementation(async () => {
        callOrder.push('readObject');
        return Buffer.from([1]);
      });
      deps.sumsubClient.findLevel.mockImplementation(async () => {
        callOrder.push('findLevel');
        return matchingLevel;
      });
      deps.sumsubClient.createApplicant.mockImplementation(async () => {
        callOrder.push('createApplicant');
        return 'applicant-1';
      });

      await connector.execute(createInput());

      expect(callOrder).toEqual(['readObject', 'findLevel', 'createApplicant']);
    });

    it('runs before createApplicant', async () => {
      const deps = createDeps();
      const connector = createConnector(deps);
      const callOrder: string[] = [];
      deps.sumsubClient.findLevel.mockImplementation(async () => {
        callOrder.push('findLevel');
        return matchingLevel;
      });
      deps.sumsubClient.createApplicant.mockImplementation(async () => {
        callOrder.push('createApplicant');
        return 'applicant-1';
      });

      await connector.execute(createInput());

      expect(callOrder).toEqual(['findLevel', 'createApplicant']);
    });

    it('throws naming both sides when a configured docSet is absent from the level', async () => {
      const deps = createDeps();
      deps.sumsubClient.findLevel.mockResolvedValue({
        name: 'individual-standard-v2',
        docSets: [{ idDocSetType: 'IDENTITY' }, { idDocSetType: 'QUESTIONNAIRE' }],
      });
      const connector = createConnector(deps);
      const input = createInput({
        config: { ...VALID_CONFIG, documents: [VALID_DOCUMENT, VALID_SECOND_DOCUMENT] },
        payload: { ...VALID_PAYLOAD, selfieDocumentId: 'document-2' },
      });

      await expect(connector.execute(input)).rejects.toThrow(SumsubLevelDocSetMismatchError);
      await expect(connector.execute(input)).rejects.toThrow(/SELFIE/);
      await expect(connector.execute(input)).rejects.toThrow(/IDENTITY/);
      expect(deps.sumsubClient.createApplicant).not.toHaveBeenCalled();
    });

    it('accepts a level carrying steps the adapter uploads nothing into', async () => {
      const deps = createDeps();
      deps.sumsubClient.findLevel.mockResolvedValue({
        name: 'individual-standard-v2',
        docSets: [
          { idDocSetType: 'APPLICANT_DATA' },
          { idDocSetType: 'IDENTITY' },
          { idDocSetType: 'SELFIE' },
          { idDocSetType: 'QUESTIONNAIRE' },
        ],
      });
      const connector = createConnector(deps);

      const result = await connector.execute(createInput());

      expect(result.isAccepted()).toBe(true);
    });

    it('throws when the level declares no QUESTIONNAIRE docSet', async () => {
      const deps = createDeps();
      deps.sumsubClient.findLevel.mockResolvedValue({
        name: 'individual-standard-v2',
        docSets: [{ idDocSetType: 'IDENTITY' }],
      });
      const connector = createConnector(deps);

      await expect(connector.execute(createInput())).rejects.toThrow(
        SumsubLevelQuestionnaireMissingError,
      );
      expect(deps.sumsubClient.createApplicant).not.toHaveBeenCalled();
    });

    it('compares the set of idDocSetType values, not the entry count', async () => {
      const deps = createDeps();
      deps.sumsubClient.findLevel.mockResolvedValue({
        name: 'individual-standard-v2',
        docSets: [
          { idDocSetType: 'IDENTITY' },
          { idDocSetType: 'IDENTITY' },
          { idDocSetType: 'QUESTIONNAIRE' },
        ],
      });
      const connector = createConnector(deps);
      const input = createInput({
        config: {
          ...VALID_CONFIG,
          documents: [
            VALID_DOCUMENT,
            { ...VALID_DOCUMENT, payloadField: 'idBackDocumentId', idDocSubType: 'BACK_SIDE' },
          ],
        },
        payload: { ...VALID_PAYLOAD, idBackDocumentId: 'document-1-back' },
      });

      const result = await connector.execute(input);

      expect(result.isAccepted()).toBe(true);
    });

    it('throws when the configured level is unknown', async () => {
      const deps = createDeps();
      deps.sumsubClient.findLevel.mockResolvedValue(undefined);
      const connector = createConnector(deps);

      await expect(connector.execute(createInput())).rejects.toThrow(SumsubLevelNotFoundError);
      expect(deps.sumsubClient.createApplicant).not.toHaveBeenCalled();
    });

    it('proceeds when the level matches', async () => {
      const deps = createDeps();
      const connector = createConnector(deps);

      const result = await connector.execute(createInput());

      expect(result.isAccepted()).toBe(true);
    });
  });

  it('never issues a delete against object storage', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    await connector.execute(createInput());

    expect(deps.objectStoragePort.deleteStagedObject).not.toHaveBeenCalled();
  });
});

describe('SumsubKycConnector.mapCallbackResult', () => {
  it('resolves applicantReviewed + completed to verified and applies the outcome', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    const result = await connector.mapCallbackResult(createCallbackInput());

    expect(result.onboardingId).toBe(ONBOARDING_ID);
    expect(result.result.isAccepted()).toBe(true);
    expect(result.submittedData).toEqual({ kycOutcome: 'verified' });
  });

  it('yields human_review for applicantOnHold without reading back the verdict', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    const result = await connector.mapCallbackResult(
      createCallbackInput({ type: 'applicantOnHold' }),
    );

    expect(result.result.isAccepted()).toBe(true);
    expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });
    expect(deps.sumsubClient.findApplicantStatus).not.toHaveBeenCalled();
  });

  it('yields human_review for applicantAwaitingService without reading back the verdict', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    const result = await connector.mapCallbackResult(
      createCallbackInput({ type: 'applicantAwaitingService' }),
    );

    expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });
    expect(deps.sumsubClient.findApplicantStatus).not.toHaveBeenCalled();
  });

  it.each(['applicantPending', 'ongoingDocExpired'])(
    'acknowledges %s by re-parking, without reading back the verdict',
    async (type) => {
      const deps = createDeps();
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput({ type }));

      expect(result.result.isPending()).toBe(true);
      expect(deps.sumsubClient.findApplicantStatus).not.toHaveBeenCalled();
    },
  );

  it('acknowledges an unrecognised type with no error thrown', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    const result = await connector.mapCallbackResult(
      createCallbackInput({ type: 'somethingSumsubInventsLater' }),
    );

    expect(result.result.isPending()).toBe(true);
  });

  it('re-parks when the read-back reviewStatus is not yet completed', async () => {
    const deps = createDeps();
    deps.sumsubClient.findApplicantStatus.mockResolvedValue({
      reviewStatus: 'pending',
      reviewResult: undefined,
    });
    const connector = createConnector(deps);

    const result = await connector.mapCallbackResult(createCallbackInput());

    expect(result.result.isPending()).toBe(true);
  });

  it('refuses a callback whose X-Payload-Digest-Alg does not match the configured algorithm', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    await expect(
      connector.mapCallbackResult(
        createCallbackInput({}, { 'x-payload-digest-alg': 'HMAC_SHA1_HEX' }),
      ),
    ).rejects.toThrow(SumsubCallbackDigestAlgorithmMismatchError);
  });

  it('treats an externalUserId that is not a UUID as already applied, without querying for it', async () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    await expect(
      connector.mapCallbackResult(createCallbackInput({ externalUserId: 'onboarding-1' })),
    ).rejects.toThrow(ConnectorCallbackAlreadyAppliedError);
    expect(deps.awaitingCallbackConnectorResolver.findConnector).not.toHaveBeenCalled();
  });

  it('throws ConnectorCallbackAlreadyAppliedError for a stale callback', async () => {
    const deps = createDeps();
    deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue(undefined);
    const connector = createConnector(deps);

    await expect(connector.mapCallbackResult(createCallbackInput())).rejects.toThrow(
      ConnectorCallbackAlreadyAppliedError,
    );
  });

  describe('the callback fieldMapping resolution', () => {
    it('resolves declared identity through a non-identity fieldMapping (lastName <- surname), not by reading context field names directly', async () => {
      const deps = createDeps();
      const contextWithoutLastName: Record<string, unknown> = { ...VALID_PAYLOAD };
      delete contextWithoutLastName.lastName;
      deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue({
        connectorOrder: 1,
        onboarding: {
          ...matchingOnboarding,
          context: { ...contextWithoutLastName, surname: 'Kowalski' },
        },
        connector: {
          ...matchingConnectorDeclaration,
          fieldMapping: { ...IDENTITY_FIELD_MAPPING, lastName: 'surname' },
        },
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(result.submittedData).toEqual({ kycOutcome: 'verified' });
    });
  });

  describe('RED verdicts', () => {
    const redStatus = (rejectType: 'RETRY' | 'FINAL') => ({
      reviewStatus: 'completed',
      reviewResult: { reviewAnswer: 'RED', reviewRejectType: rejectType },
    });

    it('refuses on reviewRejectType FINAL', async () => {
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue(redStatus('FINAL'));
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(result.submittedData).toMatchObject({ kycOutcome: 'refused' });
      expect(deps.sumsubClient.resetStep).not.toHaveBeenCalled();
    });

    it('parses a partially-reset requiredIdDocsStatus without throwing, where reviewResult is absent on a reset docSet', async () => {
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue(redStatus('RETRY'));
      deps.sumsubClient.findRequiredIdDocsStatus.mockResolvedValue({
        SELFIE: { attemptCnt: 1 },
        IDENTITY: { reviewResult: { reviewAnswer: 'RED' }, attemptCnt: 1 },
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(result.submittedData).toMatchObject({ kycOutcome: 'retry', kycRetryStep: 'IDENTITY' });
    });

    it('never writes kycAttemptCount — Sumsub counts attempts itself', async () => {
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue(redStatus('RETRY'));
      deps.sumsubClient.findRequiredIdDocsStatus.mockResolvedValue({
        IDENTITY: { reviewResult: { reviewAnswer: 'RED' }, attemptCnt: 1 },
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(result.submittedData).not.toHaveProperty('kycAttemptCount');
    });

    it('calls resetStep with the failed docSet before the retry outcome is returned, and for no other outcome', async () => {
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue(redStatus('RETRY'));
      deps.sumsubClient.findRequiredIdDocsStatus.mockResolvedValue({
        IDENTITY: { reviewResult: { reviewAnswer: 'RED' }, attemptCnt: 1 },
      });
      const callOrder: string[] = [];
      deps.sumsubClient.resetStep.mockImplementation(async () => {
        callOrder.push('resetStep');
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());
      callOrder.push('outcomeReturned');

      expect(result.submittedData).toMatchObject({ kycOutcome: 'retry' });
      expect(callOrder).toEqual(['resetStep', 'outcomeReturned']);

      deps.sumsubClient.resetStep.mockClear();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue({
        reviewStatus: 'completed',
        reviewResult: { reviewAnswer: 'GREEN' },
      });

      await connector.mapCallbackResult(createCallbackInput());

      expect(deps.sumsubClient.resetStep).not.toHaveBeenCalled();
    });

    it('treats a RED/RETRY docSet with no numeric attemptCnt as attemptCnt 0, yielding retry rather than throwing', async () => {
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue(redStatus('RETRY'));
      deps.sumsubClient.findRequiredIdDocsStatus.mockResolvedValue({
        IDENTITY: { reviewResult: { reviewAnswer: 'RED' } },
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(result.submittedData).toEqual({ kycOutcome: 'retry', kycRetryStep: 'IDENTITY' });
    });

    it('yields human_review when attemptCnt has reached the configured cap, instead of retry', async () => {
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue(redStatus('RETRY'));
      deps.sumsubClient.findRequiredIdDocsStatus.mockResolvedValue({
        IDENTITY: { reviewResult: { reviewAnswer: 'RED' }, attemptCnt: 3 },
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });
      expect(deps.sumsubClient.resetStep).not.toHaveBeenCalled();
    });
  });

  describe('a review answer that is neither GREEN nor RED', () => {
    // Documented alignment with the KYC kernel: with a declared/verified identity mismatch this
    // used to land in `human_review` through the identity guard. It is an unexplained provider
    // state like any other, so it now throws and Sumsub redelivers.
    it('throws, even when the verified identity does not match the declared one', async () => {
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue({
        reviewStatus: 'completed',
        reviewResult: { reviewAnswer: 'YELLOW' },
      });
      deps.sumsubClient.findApplicant.mockResolvedValue({
        lastName: 'SomeoneElseEntirely',
        dob: '1990-01-01',
      });
      const connector = createConnector(deps);

      await expect(connector.mapCallbackResult(createCallbackInput())).rejects.toThrow(
        SumsubOutcomeUnrecognisedStateError,
      );
    });
  });

  describe('submittedData', () => {
    it('is exactly SumsubCallbackSubmission, with no clientComment, document number or MRZ string', async () => {
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue({
        reviewStatus: 'completed',
        reviewResult: {
          reviewAnswer: 'RED',
          reviewRejectType: 'FINAL',
          moderationComment: 'Please resubmit a clearer photo',
          buttonIds: ['RETRY_ID_DOC'],
          // A real client-facing comment field this connector's types never model, proving it
          // cannot cross over even if a future provider response happened to carry it.
          clientComment: 'internal analyst note',
        },
      });
      deps.sumsubClient.findApplicant.mockResolvedValue({
        lastName: 'Kowalski',
        dob: '1990-01-01',
        idDocs: [
          {
            number: 'AB1234567',
            mrzLine1: 'P<POLKOWALSKI<<JAN<<<<<<<<<<<<<<<<<<<<<<<<<',
            mrzLine2: 'AB1234567POL9001014M3001014<<<<<<<<<<<<<<08',
          },
        ],
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(Object.keys(result.submittedData as object).sort()).toEqual(
        ['kycCustomerMessage', 'kycOutcome', 'kycReasonCodes'].sort(),
      );
      expect(result.submittedData).toEqual({
        kycOutcome: 'refused',
        kycCustomerMessage: 'Please resubmit a clearer photo',
        kycReasonCodes: ['RETRY_ID_DOC'],
      });

      const serialized = JSON.stringify(result.submittedData);
      expect(serialized).not.toContain('internal analyst note');
      expect(serialized).not.toContain('AB1234567');
      expect(serialized).not.toContain('P<POLKOWALSKI');
      expect(serialized).not.toContain('MRZ');
    });
  });

  describe('logging', () => {
    it('emits one line per RETRY outcome carrying the onboarding id, docSet, attemptCnt and the configured cap', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue({
        reviewStatus: 'completed',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'RETRY' },
      });
      deps.sumsubClient.findRequiredIdDocsStatus.mockResolvedValue({
        IDENTITY: { reviewResult: { reviewAnswer: 'RED' }, attemptCnt: 2 },
      });
      const connector = createConnector(deps);

      await connector.mapCallbackResult(createCallbackInput());

      const retryLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('KYC_RETRY'));
      expect(retryLines).toHaveLength(1);
      expect(retryLines[0]).toContain(`onboardingId=${ONBOARDING_ID}`);
      expect(retryLines[0]).toContain('connectorId=sumsub_kyc');
      expect(retryLines[0]).toContain('target=IDENTITY');
      expect(retryLines[0]).toContain('attempts=2');
      expect(retryLines[0]).toContain('maxAttemptsPerDocSet=3');
    });

    it('emits one line when the attempt cap fires, carrying the docSet, attemptCnt and configured cap', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const deps = createDeps();
      deps.sumsubClient.findApplicantStatus.mockResolvedValue({
        reviewStatus: 'completed',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'RETRY' },
      });
      deps.sumsubClient.findRequiredIdDocsStatus.mockResolvedValue({
        IDENTITY: { reviewResult: { reviewAnswer: 'RED' }, attemptCnt: 3 },
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });

      const cappedLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('KYC_ATTEMPTS_EXHAUSTED'));
      expect(cappedLines).toHaveLength(1);
      expect(cappedLines[0]).toContain(`onboardingId=${ONBOARDING_ID}`);
      expect(cappedLines[0]).toContain('connectorId=sumsub_kyc');
      expect(cappedLines[0]).toContain('target=IDENTITY');
      expect(cappedLines[0]).toContain('attempts=3');
      expect(cappedLines[0]).toContain('maxAttemptsPerDocSet=3');
    });

    it('emits one line per screening hit with only the entry key names, matchStatus and the hit count', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const deps = createDeps();
      deps.sumsubClient.findAmlCase.mockResolvedValue({
        hits: [
          {
            matchStatus: 'exact',
            disposition: 'pending',
            name: 'Someone Sanctioned',
            dob: '1975-05-05',
            comment: 'free text about the match',
          },
        ],
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });

      const hitLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('SUMSUB_SCREENING_HIT_UNRESOLVED'));
      expect(hitLines).toHaveLength(1);
      expect(hitLines[0]).toContain('matchStatus');
      expect(hitLines[0]).toContain('exact');
      expect(hitLines[0]).toContain('hitCount=1');
      expect(hitLines[0]).not.toContain('Someone Sanctioned');
      expect(hitLines[0]).not.toContain('1975-05-05');
      expect(hitLines[0]).not.toContain('free text about the match');
    });

    it('emits one line per row-3 firing naming which of mismatch or no-verified-data fired and which field diverged, never the two values', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const deps = createDeps();
      deps.sumsubClient.findApplicant.mockResolvedValue({
        lastName: 'SomeoneElseEntirely',
        dob: '1990-01-01',
      });
      const connector = createConnector(deps);

      const result = await connector.mapCallbackResult(createCallbackInput());

      expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });

      const guardLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('KYC_IDENTITY_GUARD_FIRED'));
      expect(guardLines).toHaveLength(1);
      expect(guardLines[0]).toContain('mismatchKind=mismatch');
      expect(guardLines[0]).toContain('connectorId=sumsub_kyc');
      expect(guardLines[0]).toContain('lastName');
      expect(guardLines[0]).not.toContain('Kowalski');
      expect(guardLines[0]).not.toContain('SomeoneElseEntirely');
    });

    it('emits a row-3 line naming no-verified-data when Sumsub returns no verified identity block', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const deps = createDeps();
      deps.sumsubClient.findApplicant.mockResolvedValue({});
      const connector = createConnector(deps);

      await connector.mapCallbackResult(createCallbackInput());

      const guardLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('KYC_IDENTITY_GUARD_FIRED'));
      expect(guardLines).toHaveLength(1);
      expect(guardLines[0]).toContain('mismatchKind=no-verified-data');
    });
  });
});
