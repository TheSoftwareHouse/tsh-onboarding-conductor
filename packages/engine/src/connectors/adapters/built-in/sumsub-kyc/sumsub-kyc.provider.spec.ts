import { Logger } from '@nestjs/common';
import { parseKycConfig } from '../kyc/kyc-config';
import type { KycSubmission } from '../kyc/kyc-provider.port';
import { SumsubConfigInvalidError } from './sumsub-config';
import {
  SumsubCallbackDigestAlgorithmMismatchError,
  SumsubKycProvider,
  SumsubLevelDocSetMismatchError,
  SumsubLevelNotFoundError,
  SumsubLevelQuestionnaireMissingError,
  type SumsubCallbackEvent,
} from './sumsub-kyc.provider';
import { SumsubOutcomeUnrecognisedStateError } from './sumsub-outcome';

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';
const CREDENTIALS = { appToken: 'app-token-1', secretKey: 'secret-key-1' };

const settings = {
  find: jest.fn(),
  get: (key: string) =>
    key === 'appToken'
      ? 'app-token-1'
      : key === 'secretKey'
        ? 'secret-key-1'
        : (undefined as never),
};

const SUBMISSION: KycSubmission = {
  onboardingId: ONBOARDING_ID,
  sourceKey: 'sumsub',
  providerConfig: {
    levelName: 'individual-standard-v2',
    questionnaireDefinitionId: 'questionnaire',
  },
  applicant: {
    firstName: 'Jan',
    lastName: 'Kowalski',
    dateOfBirth: '1990-01-01',
    nationality: 'PL',
    country: 'PL',
    town: 'Warsaw',
  },
  documents: [
    {
      documentId: 'document-1',
      sourceField: 'idCardFront',
      docSet: 'IDENTITY',
      docType: 'ID_CARD',
      side: 'FRONT_SIDE',
      country: 'PL',
      contentType: 'image/png',
      content: Buffer.from([1, 2, 3]),
    },
    {
      documentId: 'document-2',
      sourceField: 'selfieDocument',
      docSet: 'SELFIE',
      docType: 'SELFIE',
      country: 'PL',
      contentType: 'image/jpeg',
      content: Buffer.from([4]),
    },
  ],
  questionnaire: {
    pathMap: { purposeOfAccount: 'purpose.accountPurpose' },
    answers: { purposeOfAccount: 'savings' },
  },
};

const LEVEL = {
  name: 'individual-standard-v2',
  docSets: [
    { idDocSetType: 'APPLICANT_DATA' },
    { idDocSetType: 'IDENTITY' },
    { idDocSetType: 'SELFIE' },
    { idDocSetType: 'QUESTIONNAIRE' },
  ],
};

const createClient = () => ({
  findLevel: jest.fn().mockResolvedValue(LEVEL),
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
});

const createProvider = () => {
  const client = createClient();

  return { client, provider: new SumsubKycProvider(client as never) };
};

const callback = (
  overrides: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string | undefined>> = {
    'x-payload-digest-alg': 'HMAC_SHA256_HEX',
  },
) => ({
  rawBody: new TextEncoder().encode(
    JSON.stringify({
      type: 'applicantReviewed',
      externalUserId: ONBOARDING_ID,
      applicantId: 'applicant-1',
      ...overrides,
    }),
  ),
  headers,
});

const event = (hint = 'reviewed'): SumsubCallbackEvent => ({
  onboardingId: ONBOARDING_ID,
  providerReference: 'applicant-1',
  actionable: true,
  hint,
});

describe('SumsubKycProvider', () => {
  it('declares the Sumsub identity, signature recipe and that it counts attempts itself', () => {
    const { provider } = createProvider();

    expect(provider).toMatchObject({
      id: 'sumsub_kyc',
      name: 'sumsub_kyc',
      countsAttempts: true,
      callbackAuth: {
        kind: 'hmac',
        algorithm: 'sha256',
        signatureHeader: 'x-payload-digest',
        encoding: 'hex',
      },
    });
    expect(provider.settingsSchema.fields.map((field) => field.key)).toEqual([
      'appToken',
      'secretKey',
      'callbackSigningSecret',
    ]);
  });

  describe('validateConfig', () => {
    const config = parseKycConfig('sumsub_kyc', {
      sourceKey: 'sumsub',
      documents: [
        { payloadField: 'a', idDocSetType: 'IDENTITY', idDocType: 'ID_CARD', country: 'PL' },
      ],
      questionnairePathMap: { item: 'section.item' },
      maxAttemptsPerDocSet: 3,
    });

    it('accepts a level, a questionnaire definition and a questionnaire path map', () => {
      const { provider } = createProvider();

      expect(() =>
        provider.validateConfig(
          { levelName: 'level', questionnaireDefinitionId: 'questionnaire' },
          config,
        ),
      ).not.toThrow();
    });

    it.each(['levelName', 'questionnaireDefinitionId'])('refuses a missing %s', (missing) => {
      const { provider } = createProvider();
      const providerConfig: Record<string, unknown> = {
        levelName: 'level',
        questionnaireDefinitionId: 'questionnaire',
      };
      delete providerConfig[missing];

      expect(() => provider.validateConfig(providerConfig, config)).toThrow(new RegExp(missing));
    });

    it('refuses a declaration with no questionnaire path map', () => {
      const { provider } = createProvider();

      expect(() =>
        provider.validateConfig(
          { levelName: 'level', questionnaireDefinitionId: 'questionnaire' },
          { ...config, questionnairePathMap: undefined },
        ),
      ).toThrow(/questionnairePathMap/);
    });
  });

  describe('submit', () => {
    it('runs the level check, then the applicant, every upload, the questionnaire and the finalise, in order', async () => {
      const { client, provider } = createProvider();
      const order: string[] = [];
      for (const name of [
        'findLevel',
        'createApplicant',
        'uploadIdDoc',
        'submitQuestionnaire',
        'finalizeSubmission',
      ] as const) {
        client[name].mockImplementation(async () => {
          order.push(name);
          return name === 'createApplicant' ? 'applicant-1' : undefined;
        });
      }
      client.findLevel.mockImplementation(async () => {
        order.push('findLevel');
        return LEVEL;
      });

      const receipt = await provider.submit(settings, SUBMISSION);

      expect(receipt).toEqual({ providerReference: 'applicant-1' });
      expect(order).toEqual([
        'findLevel',
        'createApplicant',
        'uploadIdDoc',
        'uploadIdDoc',
        'submitQuestionnaire',
        'finalizeSubmission',
      ]);
    });

    it('creates the applicant with the onboarding id, the source key and alpha-3 fixedInfo', async () => {
      const { client, provider } = createProvider();

      await provider.submit(settings, SUBMISSION);

      expect(client.createApplicant).toHaveBeenCalledWith(CREDENTIALS, 'individual-standard-v2', {
        externalUserId: ONBOARDING_ID,
        sourceKey: 'sumsub',
        fixedInfo: expect.objectContaining({
          nationality: 'POL',
          country: 'POL',
          addresses: [{ street: undefined, town: 'Warsaw', postCode: undefined }],
        }),
      });
    });

    it('uploads each document with alpha-3 metadata, the documentId as file name and octet-stream', async () => {
      const { client, provider } = createProvider();

      await provider.submit(settings, SUBMISSION);

      expect(client.uploadIdDoc).toHaveBeenNthCalledWith(1, CREDENTIALS, {
        applicantId: 'applicant-1',
        metadata: { idDocType: 'ID_CARD', idDocSubType: 'FRONT_SIDE', country: 'POL' },
        fileName: 'document-1',
        contentType: 'application/octet-stream',
        fileContent: Buffer.from([1, 2, 3]),
      });
      expect(client.uploadIdDoc).toHaveBeenNthCalledWith(
        2,
        CREDENTIALS,
        expect.objectContaining({
          metadata: { idDocType: 'SELFIE', country: 'POL' },
          fileName: 'document-2',
        }),
      );
    });

    it('submits the questionnaire under its definition id', async () => {
      const { client, provider } = createProvider();

      await provider.submit(settings, SUBMISSION);

      expect(client.submitQuestionnaire).toHaveBeenCalledWith(
        CREDENTIALS,
        'applicant-1',
        expect.objectContaining({ id: 'questionnaire', sections: expect.any(Object) }),
      );
    });

    it('refuses a submission with no questionnaire before any call', async () => {
      const { client, provider } = createProvider();

      await expect(
        provider.submit(settings, { ...SUBMISSION, questionnaire: undefined }),
      ).rejects.toThrow(SumsubConfigInvalidError);
      expect(client.findLevel).not.toHaveBeenCalled();
    });

    describe('the level drift check', () => {
      it('throws when the level is unknown, before createApplicant', async () => {
        const { client, provider } = createProvider();
        client.findLevel.mockResolvedValue(undefined);

        await expect(provider.submit(settings, SUBMISSION)).rejects.toThrow(
          SumsubLevelNotFoundError,
        );
        expect(client.createApplicant).not.toHaveBeenCalled();
      });

      it('throws naming both sides when a submitted docSet is absent from the level', async () => {
        const { client, provider } = createProvider();
        client.findLevel.mockResolvedValue({
          name: 'individual-standard-v2',
          docSets: [{ idDocSetType: 'IDENTITY' }, { idDocSetType: 'QUESTIONNAIRE' }],
        });

        await expect(provider.submit(settings, SUBMISSION)).rejects.toThrow(
          SumsubLevelDocSetMismatchError,
        );
        await expect(provider.submit(settings, SUBMISSION)).rejects.toThrow(/SELFIE/);
        expect(client.createApplicant).not.toHaveBeenCalled();
      });

      it('throws when the level declares no QUESTIONNAIRE docSet', async () => {
        const { client, provider } = createProvider();
        client.findLevel.mockResolvedValue({
          name: 'individual-standard-v2',
          docSets: [{ idDocSetType: 'IDENTITY' }, { idDocSetType: 'SELFIE' }],
        });

        await expect(provider.submit(settings, SUBMISSION)).rejects.toThrow(
          SumsubLevelQuestionnaireMissingError,
        );
        expect(client.createApplicant).not.toHaveBeenCalled();
      });
    });
  });

  describe('parseCallback', () => {
    it.each([
      ['applicantReviewed', 'reviewed'],
      ['applicantOnHold', 'on_hold'],
      ['applicantAwaitingService', 'on_hold'],
    ])('treats %s as actionable with hint %s', (type, hint) => {
      const { provider } = createProvider();

      expect(provider.parseCallback(callback({ type }))).toEqual({
        onboardingId: ONBOARDING_ID,
        providerReference: 'applicant-1',
        actionable: true,
        hint,
      });
    });

    it.each(['applicantPending', 'ongoingDocExpired', 'somethingSumsubInventsLater'])(
      'acknowledges %s without acting on it',
      (type) => {
        const { provider } = createProvider();

        expect(provider.parseCallback(callback({ type }))).toEqual({
          onboardingId: ONBOARDING_ID,
          providerReference: 'applicant-1',
          actionable: false,
        });
      },
    );

    it.each([
      ['a different algorithm', { 'x-payload-digest-alg': 'HMAC_SHA1_HEX' }],
      ['no algorithm header', {}],
    ])('refuses a callback with %s', (_label, headers) => {
      const { provider } = createProvider();

      expect(() => provider.parseCallback(callback({}, headers))).toThrow(
        SumsubCallbackDigestAlgorithmMismatchError,
      );
    });

    it.each(['type', 'externalUserId', 'applicantId'])('refuses a body missing %s', (field) => {
      const { provider } = createProvider();

      expect(() => provider.parseCallback(callback({ [field]: undefined }))).toThrow(
        new RegExp(`"${field}"`),
      );
    });

    it('refuses a body that is not UTF-8, JSON or an object', () => {
      const { provider } = createProvider();
      const headers = { 'x-payload-digest-alg': 'HMAC_SHA256_HEX' };

      expect(() =>
        provider.parseCallback({ rawBody: Uint8Array.from([0xff, 0xfe]), headers }),
      ).toThrow(/UTF-8/);
      expect(() =>
        provider.parseCallback({ rawBody: new TextEncoder().encode('nope'), headers }),
      ).toThrow(/JSON/);
      expect(() =>
        provider.parseCallback({ rawBody: new TextEncoder().encode('null'), headers }),
      ).toThrow(/must be an object/);
    });
  });

  describe('buildReconcileEvent', () => {
    it('reads the applicant as reviewed, so an unfinished review answers pending', async () => {
      const { client, provider } = createProvider();
      client.findApplicantStatus.mockResolvedValue({ reviewStatus: 'pending' });
      const reconcileEvent = provider.buildReconcileEvent({
        onboardingId: ONBOARDING_ID,
        providerReference: 'applicant-1',
      });

      expect(reconcileEvent).toEqual(event('reviewed'));
      await expect(provider.fetchVerdict(settings, reconcileEvent)).resolves.toEqual({
        kind: 'pending',
      });
    });
  });

  describe('fetchVerdict', () => {
    it('answers needs_review for an on-hold event without reading anything back', async () => {
      const { client, provider } = createProvider();

      expect(await provider.fetchVerdict(settings, event('on_hold'))).toEqual({
        kind: 'needs_review',
        reason: 'on_hold_or_awaiting_service',
      });
      expect(client.findApplicantStatus).not.toHaveBeenCalled();
    });

    it('answers pending while the review is not completed', async () => {
      const { client, provider } = createProvider();
      client.findApplicantStatus.mockResolvedValue({ reviewStatus: 'pending' });

      expect(await provider.fetchVerdict(settings, event())).toEqual({ kind: 'pending' });
      expect(client.findApplicant).not.toHaveBeenCalled();
    });

    it('answers approved with the verified last name and date of birth on GREEN', async () => {
      const { provider } = createProvider();

      expect(await provider.fetchVerdict(settings, event())).toEqual({
        kind: 'approved',
        verifiedIdentity: { lastName: 'Kowalski', dateOfBirth: '1990-01-01' },
      });
    });

    it('reads the verdict for the event’s applicant with the stored credentials', async () => {
      const { client, provider } = createProvider();

      await provider.fetchVerdict(settings, event());

      expect(client.findApplicantStatus).toHaveBeenCalledWith(CREDENTIALS, 'applicant-1');
      expect(client.findApplicant).toHaveBeenCalledWith(CREDENTIALS, 'applicant-1');
      expect(client.findAmlCase).toHaveBeenCalledWith(CREDENTIALS, 'applicant-1');
      expect(client.findRequiredIdDocsStatus).not.toHaveBeenCalled();
    });

    describe('RED', () => {
      const red = (rejectType: 'RETRY' | 'FINAL', extra = {}) => ({
        reviewStatus: 'completed',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: rejectType, ...extra },
      });

      it('answers declined on FINAL, with buttonIds and the moderation comment only', async () => {
        const { client, provider } = createProvider();
        client.findApplicantStatus.mockResolvedValue(
          red('FINAL', {
            moderationComment: 'Please resubmit',
            buttonIds: ['RETRY_ID_DOC'],
            clientComment: 'internal analyst note',
          }),
        );

        const verdict = await provider.fetchVerdict(settings, event());

        expect(verdict).toEqual({
          kind: 'declined',
          reasonCodes: ['RETRY_ID_DOC'],
          customerMessage: 'Please resubmit',
        });
      });

      it('answers a resubmission of the failed docSet with Sumsub’s attemptCnt', async () => {
        const { client, provider } = createProvider();
        client.findApplicantStatus.mockResolvedValue(red('RETRY'));
        client.findRequiredIdDocsStatus.mockResolvedValue({
          SELFIE: { attemptCnt: 1 },
          IDENTITY: { reviewResult: { reviewAnswer: 'RED' }, attemptCnt: 2 },
        });

        expect(await provider.fetchVerdict(settings, event())).toMatchObject({
          kind: 'resubmission',
          target: 'IDENTITY',
          attemptCount: 2,
        });
      });

      it('treats a failed docSet with no numeric attemptCnt as 0', async () => {
        const { client, provider } = createProvider();
        client.findApplicantStatus.mockResolvedValue(red('RETRY'));
        client.findRequiredIdDocsStatus.mockResolvedValue({
          IDENTITY: { reviewResult: { reviewAnswer: 'RED' } },
        });

        expect(await provider.fetchVerdict(settings, event())).toMatchObject({
          kind: 'resubmission',
          attemptCount: 0,
        });
      });

      it('throws when no docSet can be named as the failed one', async () => {
        const { client, provider } = createProvider();
        client.findApplicantStatus.mockResolvedValue(red('RETRY'));

        await expect(provider.fetchVerdict(settings, event())).rejects.toThrow(
          SumsubOutcomeUnrecognisedStateError,
        );
      });
    });

    it('throws on a review answer that is neither GREEN nor RED', async () => {
      const { client, provider } = createProvider();
      client.findApplicantStatus.mockResolvedValue({
        reviewStatus: 'completed',
        reviewResult: { reviewAnswer: 'YELLOW' },
      });

      await expect(provider.fetchVerdict(settings, event())).rejects.toThrow(
        SumsubOutcomeUnrecognisedStateError,
      );
    });

    describe('screening', () => {
      it('answers needs_review for an unresolved hit and logs key names, matchStatus and the count only', async () => {
        const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        const { client, provider } = createProvider();
        client.findAmlCase.mockResolvedValue({
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

        const verdict = await provider.fetchVerdict(settings, event());

        expect(verdict).toEqual({
          kind: 'needs_review',
          reason: 'screening_unresolved',
          detail: { hitCount: 1 },
        });
        const lines = logSpy.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.includes('SUMSUB_SCREENING_HIT_UNRESOLVED'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`onboardingId=${ONBOARDING_ID}`);
        expect(lines[0]).toContain('exact');
        expect(lines[0]).toContain('hitCount=1');
        expect(lines[0]).not.toContain('Someone Sanctioned');
        expect(lines[0]).not.toContain('1975-05-05');
        expect(lines[0]).not.toContain('free text about the match');
      });

      it('treats a 204 (no case) as unresolved screening', async () => {
        const { client, provider } = createProvider();
        client.findAmlCase.mockResolvedValue(undefined);

        expect(await provider.fetchVerdict(settings, event())).toMatchObject({
          kind: 'needs_review',
          reason: 'screening_unresolved',
          detail: { hitCount: 0 },
        });
      });
    });
  });

  describe('onRetry', () => {
    it('resets the failed step for the event’s applicant', async () => {
      const { client, provider } = createProvider();

      await provider.onRetry(settings, event(), 'IDENTITY');

      expect(client.resetStep).toHaveBeenCalledWith(CREDENTIALS, 'applicant-1', 'IDENTITY');
    });
  });
});
