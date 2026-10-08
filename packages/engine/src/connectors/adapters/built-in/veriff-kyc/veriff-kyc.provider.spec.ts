import { Logger } from '@nestjs/common';
import { KycConfigInvalidError, parseKycConfig } from '../kyc/kyc-config';
import type { KycDocument, KycSubmission } from '../kyc/kyc-provider.port';
import {
  resolveVeriffMediaContext,
  resolveVeriffRetryTarget,
  VeriffCallbackAuthClientMismatchError,
  VeriffDecisionNotAvailableError,
  VeriffDecisionUnrecognisedStateError,
  VeriffDecisionVendorDataMismatchError,
  VeriffKycProvider,
  type VeriffCallbackEvent,
} from './veriff-kyc.provider';

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';
const CREDENTIALS = { apiKey: 'api-key-1', sharedSecretKey: 'secret-1' };

const settings = {
  find: jest.fn(),
  get: (key: string) =>
    key === 'apiKey'
      ? 'api-key-1'
      : key === 'sharedSecretKey'
        ? 'secret-1, secret-0'
        : (undefined as never),
};

const idDocument = (overrides: Record<string, unknown> = {}) => ({
  documentId: 'document-1',
  docSet: 'IDENTITY',
  docType: 'ID_CARD',
  side: 'FRONT_SIDE',
  country: 'PL',
  contentType: 'image/png',
  content: Buffer.from([1, 2, 3]),
  ...overrides,
});

const SELFIE_DOCUMENT = {
  documentId: 'document-2',
  docSet: 'SELFIE',
  docType: 'SELFIE',
  country: 'PL',
  contentType: 'image/jpeg',
  content: Buffer.from([4]),
};

const submission = (documents: KycSubmission['documents']): KycSubmission => ({
  onboardingId: ONBOARDING_ID,
  sourceKey: 'veriff',
  providerConfig: { levelName: 'ignored' },
  applicant: {
    firstName: 'Jan',
    lastName: 'Kowalski',
    dateOfBirth: '1990-01-01',
    nationality: 'PL',
    country: 'PL',
  },
  documents,
});

const SUBMISSION = submission([idDocument(), SELFIE_DOCUMENT]);

const createClient = () => ({
  createSession: jest.fn().mockResolvedValue({ id: 'session-1', status: 'success' }),
  uploadMedia: jest.fn().mockResolvedValue('image-1'),
  submitSession: jest.fn().mockResolvedValue(undefined),
  findDecision: jest.fn().mockResolvedValue({
    id: 'session-1',
    status: 'approved',
    vendorData: ONBOARDING_ID,
    person: { lastName: 'Kowalski', dateOfBirth: '1990-01-01' },
  }),
});

const createProvider = () => {
  const client = createClient();
  const fitter = { fit: jest.fn(async (document: KycDocument) => document) };

  return { client, fitter, provider: new VeriffKycProvider(client as never, fitter as never) };
};

const body = (record: Record<string, unknown>) => new TextEncoder().encode(JSON.stringify(record));

const decisionWebhook = (verification: Record<string, unknown> = {}) =>
  body({
    status: 'success',
    verification: {
      id: 'session-1',
      vendorData: ONBOARDING_ID,
      status: 'approved',
      ...verification,
    },
  });

const callbackInput = (
  rawBody: Uint8Array,
  headers: Readonly<Record<string, string | undefined>> = { 'x-auth-client': 'api-key-1' },
) => ({ rawBody, headers });

const event: VeriffCallbackEvent = {
  onboardingId: ONBOARDING_ID,
  providerReference: 'session-1',
  actionable: true,
};

describe('VeriffKycProvider', () => {
  it('declares the Veriff identity, signature recipe and that the kernel counts attempts', () => {
    const { provider } = createProvider();

    expect(provider).toMatchObject({
      id: 'veriff_kyc',
      name: 'veriff_kyc',
      countsAttempts: false,
      callbackAuth: {
        kind: 'hmac',
        algorithm: 'sha256',
        signatureHeader: 'x-hmac-signature',
        encoding: 'hex',
        secretSettingKey: 'sharedSecretKey',
      },
    });
    expect(provider.settingsSchema.fields.map((field) => field.key)).toEqual([
      'apiKey',
      'sharedSecretKey',
    ]);
    expect('onRetry' in provider).toBe(false);
  });

  describe('resolveVeriffMediaContext', () => {
    it.each([
      [{ docSet: 'IDENTITY', side: 'FRONT_SIDE' }, 'document-front'],
      [{ docSet: 'IDENTITY', docType: 'PASSPORT' }, 'document-front'],
      [{ docSet: 'IDENTITY', docType: 'ID_CARD', side: 'BACK_SIDE' }, 'document-back'],
      [{ docSet: 'SELFIE', docType: 'SELFIE' }, 'face'],
      [{ docSet: 'IDENTITY', side: 'LEFT_SIDE' }, undefined],
      [{ docSet: 'PROOF_OF_RESIDENCE' }, undefined],
      [{ docSet: 'QUESTIONNAIRE' }, undefined],
    ])('maps %j to %s', (input, expected) => {
      expect(resolveVeriffMediaContext(input)).toBe(expected);
    });
  });

  describe('resolveVeriffRetryTarget', () => {
    it.each([
      [202, 'SELFIE'],
      [208, 'SELFIE'],
      [214, 'SELFIE'],
      [102, 'IDENTITY'],
      [539, 'IDENTITY'],
      [undefined, 'IDENTITY'],
    ])('maps reason code %s to %s', (code, expected) => {
      expect(resolveVeriffRetryTarget(code)).toBe(expected);
    });
  });

  describe('validateConfig', () => {
    const configWith = (documents: Record<string, unknown>[]) =>
      parseKycConfig('veriff_kyc', {
        sourceKey: 'veriff',
        documents: documents.map((document) => ({
          payloadField: 'a',
          idDocType: 'ID_CARD',
          country: 'PL',
          ...document,
        })),
        maxAttemptsPerDocSet: 3,
      });

    it('accepts front, back and selfie documents and ignores Sumsub provider keys', () => {
      const { provider } = createProvider();
      const config = configWith([
        { idDocSetType: 'IDENTITY', idDocSubType: 'FRONT_SIDE' },
        { idDocSetType: 'IDENTITY', idDocSubType: 'BACK_SIDE' },
        { idDocSetType: 'SELFIE', idDocType: 'SELFIE' },
      ]);

      expect(() =>
        provider.validateConfig({ levelName: 'level', questionnaireDefinitionId: 'q' }, config),
      ).not.toThrow();
    });

    it.each([
      ['an unmappable docSet', { idDocSetType: 'PROOF_OF_RESIDENCE' }],
      ['an unmappable side', { idDocSetType: 'IDENTITY', idDocSubType: 'LEFT_SIDE' }],
    ])('refuses %s', (_label, document) => {
      const { provider } = createProvider();

      expect(() => provider.validateConfig({}, configWith([document]))).toThrow(
        KycConfigInvalidError,
      );
    });
  });

  describe('submit', () => {
    it('creates the session with the onboarding id as vendorData and the applicant as person', async () => {
      const { client, provider } = createProvider();

      await provider.submit(settings, SUBMISSION);

      expect(client.createSession).toHaveBeenCalledWith(CREDENTIALS, {
        vendorData: ONBOARDING_ID,
        person: { firstName: 'Jan', lastName: 'Kowalski', dateOfBirth: '1990-01-01' },
        document: { type: 'ID_CARD', country: 'PL' },
      });
    });

    it('prefills the document only when the identity documents share one supported type', async () => {
      const { client, provider } = createProvider();

      await provider.submit(
        settings,
        submission([
          idDocument({ docType: 'PASSPORT', side: undefined, country: 'DE' }),
          SELFIE_DOCUMENT,
        ]),
      );
      await provider.submit(
        settings,
        submission([idDocument(), idDocument({ side: 'BACK_SIDE', documentId: 'document-3' })]),
      );
      await provider.submit(
        settings,
        submission([idDocument(), idDocument({ docType: 'PASSPORT', documentId: 'document-3' })]),
      );
      await provider.submit(settings, submission([idDocument({ docType: 'VISA' })]));
      await provider.submit(settings, submission([SELFIE_DOCUMENT]));

      const documents = client.createSession.mock.calls.map(([, request]) => request.document);

      expect(documents).toEqual([
        { type: 'PASSPORT', country: 'DE' },
        { type: 'ID_CARD', country: 'PL' },
        undefined,
        undefined,
        undefined,
      ]);
    });

    it('uploads each document in order with its media context, content type and bytes', async () => {
      const { client, provider } = createProvider();

      await provider.submit(
        settings,
        submission([
          idDocument({ docType: 'PASSPORT', side: undefined }),
          idDocument({ side: 'BACK_SIDE', documentId: 'document-3', contentType: 'image/webp' }),
          SELFIE_DOCUMENT,
        ]),
      );

      expect(client.uploadMedia.mock.calls).toEqual([
        [
          CREDENTIALS,
          {
            sessionId: 'session-1',
            context: 'document-front',
            contentType: 'image/png',
            content: Buffer.from([1, 2, 3]),
          },
        ],
        [
          CREDENTIALS,
          {
            sessionId: 'session-1',
            context: 'document-back',
            contentType: 'image/webp',
            content: Buffer.from([1, 2, 3]),
          },
        ],
        [
          CREDENTIALS,
          {
            sessionId: 'session-1',
            context: 'face',
            contentType: 'image/jpeg',
            content: Buffer.from([4]),
          },
        ],
      ]);
    });

    it('uploads what the fitter returns for each document', async () => {
      const { client, fitter, provider } = createProvider();
      fitter.fit.mockImplementation(async (document: KycDocument) => ({
        ...document,
        content: Buffer.from([9, 9]),
      }));

      await provider.submit(settings, SUBMISSION);

      expect(fitter.fit).toHaveBeenCalledTimes(2);
      expect(fitter.fit).toHaveBeenNthCalledWith(1, SUBMISSION.documents[0]);
      expect(fitter.fit).toHaveBeenNthCalledWith(2, SUBMISSION.documents[1]);
      expect(client.uploadMedia.mock.calls.map(([, request]) => request.content)).toEqual([
        Buffer.from([9, 9]),
        Buffer.from([9, 9]),
      ]);
    });

    it('creates the session, uploads, then submits it, and returns the session id', async () => {
      const { client, provider } = createProvider();
      const order: string[] = [];
      client.createSession.mockImplementation(async () => {
        order.push('createSession');
        return { id: 'session-1', status: 'success' };
      });
      client.uploadMedia.mockImplementation(async () => {
        order.push('uploadMedia');
        return 'image-1';
      });
      client.submitSession.mockImplementation(async () => {
        order.push('submitSession');
      });

      const receipt = await provider.submit(settings, SUBMISSION);

      expect(receipt).toEqual({ providerReference: 'session-1' });
      expect(order).toEqual(['createSession', 'uploadMedia', 'uploadMedia', 'submitSession']);
      expect(client.submitSession).toHaveBeenCalledWith(CREDENTIALS, 'session-1');
    });

    it('opens a new session on every call', async () => {
      const { client, provider } = createProvider();
      client.createSession
        .mockResolvedValueOnce({ id: 'session-1', status: 'success' })
        .mockResolvedValueOnce({ id: 'session-2', status: 'success' });

      const first = await provider.submit(settings, SUBMISSION);
      const second = await provider.submit(settings, SUBMISSION);

      expect(first.providerReference).toBe('session-1');
      expect(second.providerReference).toBe('session-2');
      expect(client.createSession).toHaveBeenCalledTimes(2);
    });

    it('logs the onboarding and session ids and nothing about the applicant', async () => {
      const { provider } = createProvider();
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await provider.submit(settings, SUBMISSION);

      expect(log).toHaveBeenCalledWith(
        `VERIFF_SESSION_CREATED onboardingId=${ONBOARDING_ID} sessionId=session-1`,
      );
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/Kowalski|1990|api-key|secret/);
      log.mockRestore();
    });

    it('refuses a document with no media context after creating nothing it cannot finish', async () => {
      const { client, provider } = createProvider();

      await expect(
        provider.submit(settings, submission([idDocument({ docSet: 'PROOF_OF_RESIDENCE' })])),
      ).rejects.toThrow(KycConfigInvalidError);
      expect(client.submitSession).not.toHaveBeenCalled();
    });
  });

  describe('parseCallback', () => {
    it('reduces a decision webhook to an actionable event', () => {
      const { provider } = createProvider();

      expect(provider.parseCallback(callbackInput(decisionWebhook()), settings)).toEqual({
        onboardingId: ONBOARDING_ID,
        providerReference: 'session-1',
        actionable: true,
      });
    });

    it.each([
      ['an action', { action: 'submitted', vendorData: ONBOARDING_ID, id: 's' }],
      ['a feature', { feature: 'selfid', vendorData: ONBOARDING_ID, id: 's' }],
    ])('treats %s event webhook as non-actionable', (_label, record) => {
      const { provider } = createProvider();

      expect(provider.parseCallback(callbackInput(body(record)), settings)).toEqual({
        onboardingId: ONBOARDING_ID,
        actionable: false,
      });
    });

    it('gives an event with no vendorData an empty onboarding id', () => {
      const { provider } = createProvider();

      expect(provider.parseCallback(callbackInput(body({ action: 'started' })), settings)).toEqual({
        onboardingId: '',
        actionable: false,
      });
    });

    it('throws when X-AUTH-CLIENT is not the configured api key', () => {
      const { provider } = createProvider();

      expect(() =>
        provider.parseCallback(
          callbackInput(decisionWebhook(), { 'x-auth-client': 'other' }),
          settings,
        ),
      ).toThrow(VeriffCallbackAuthClientMismatchError);
      expect(() => provider.parseCallback(callbackInput(decisionWebhook(), {}), settings)).toThrow(
        VeriffCallbackAuthClientMismatchError,
      );
    });

    it.each([
      ['vendorData', { vendorData: undefined }],
      ['id', { id: ' ' }],
    ])('throws on a decision with no %s', (_field, override) => {
      const { provider } = createProvider();

      expect(() =>
        provider.parseCallback(callbackInput(decisionWebhook(override)), settings),
      ).toThrow(/missing required field/);
    });

    it.each([
      ['non-UTF-8', new Uint8Array([0xff, 0xfe])],
      ['non-JSON', new TextEncoder().encode('not json')],
      ['a non-object', new TextEncoder().encode('[1]')],
    ])('throws on a %s body', (_label, rawBody) => {
      const { provider } = createProvider();

      expect(() => provider.parseCallback(callbackInput(rawBody), settings)).toThrow(Error);
    });
  });

  describe('fetchVerdict', () => {
    const decideWith = async (decision: Record<string, unknown>) => {
      const { client, provider } = createProvider();
      client.findDecision.mockResolvedValue({
        id: 'session-1',
        vendorData: ONBOARDING_ID,
        ...decision,
      });

      return provider.fetchVerdict(settings, event);
    };

    it('reads the decision with the credentials and the session id', async () => {
      const { client, provider } = createProvider();

      await provider.fetchVerdict(settings, event);

      expect(client.findDecision).toHaveBeenCalledWith(CREDENTIALS, 'session-1');
    });

    it('answers pending for a reconcile read with no decision yet, while a webhook read still throws', async () => {
      const { client, provider } = createProvider();
      client.findDecision.mockResolvedValue(undefined);
      const reconcileEvent = provider.buildReconcileEvent({
        onboardingId: ONBOARDING_ID,
        providerReference: 'session-1',
      });

      expect(reconcileEvent).toEqual({
        onboardingId: ONBOARDING_ID,
        providerReference: 'session-1',
        actionable: true,
        origin: 'reconcile',
      });
      await expect(provider.fetchVerdict(settings, reconcileEvent)).resolves.toEqual({
        kind: 'pending',
      });
      await expect(provider.fetchVerdict(settings, event)).rejects.toBeInstanceOf(
        VeriffDecisionNotAvailableError,
      );
    });

    it('logs the decision status and codes and never its free text or person', async () => {
      const { client, provider } = createProvider();
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      client.findDecision.mockResolvedValue({
        id: 'session-1',
        vendorData: ONBOARDING_ID,
        status: 'declined',
        code: 9102,
        reasonCode: 102,
        reason: 'Suspected document tampering',
        person: { lastName: 'Kowalski', dateOfBirth: '1990-01-01' },
      });

      await provider.fetchVerdict(settings, event);

      expect(log).toHaveBeenCalledWith(
        `VERIFF_DECISION onboardingId=${ONBOARDING_ID} sessionId=session-1 status=declined ` +
          'code=9102 reasonCode=102',
      );
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/tampering|Kowalski|1990/);
    });

    it('logs none for a decision without code or reason code', async () => {
      const { client, provider } = createProvider();
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      client.findDecision.mockResolvedValue({
        id: 'session-1',
        vendorData: ONBOARDING_ID,
        status: 'review',
      });

      await provider.fetchVerdict(settings, event);

      expect(log).toHaveBeenCalledWith(
        `VERIFF_DECISION onboardingId=${ONBOARDING_ID} sessionId=session-1 status=review ` +
          'code=none reasonCode=none',
      );
    });

    it('throws when Veriff has no decision yet', async () => {
      const { client, provider } = createProvider();
      client.findDecision.mockResolvedValue(undefined);

      await expect(provider.fetchVerdict(settings, event)).rejects.toThrow(
        VeriffDecisionNotAvailableError,
      );
    });

    it('throws when the read-back vendorData names another onboarding', async () => {
      await expect(decideWith({ status: 'approved', vendorData: 'someone-else' })).rejects.toThrow(
        VeriffDecisionVendorDataMismatchError,
      );
    });

    it('accepts a decision with no read-back vendorData', async () => {
      await expect(decideWith({ status: 'review', vendorData: undefined })).resolves.toEqual({
        kind: 'pending',
      });
    });

    it('maps review to pending', async () => {
      await expect(decideWith({ status: 'review' })).resolves.toEqual({ kind: 'pending' });
    });

    it('maps approved to the verified last name and date of birth', async () => {
      await expect(
        decideWith({
          status: 'approved',
          person: { lastName: 'Kowalski', dateOfBirth: '1990-01-01', firstName: 'Jan' },
        }),
      ).resolves.toEqual({
        kind: 'approved',
        verifiedIdentity: { lastName: 'Kowalski', dateOfBirth: '1990-01-01' },
      });
      await expect(decideWith({ status: 'approved', person: { lastName: 5 } })).resolves.toEqual({
        kind: 'approved',
        verifiedIdentity: { lastName: undefined, dateOfBirth: undefined },
      });
    });

    it('maps declined with its reason code and message', async () => {
      await expect(
        decideWith({ status: 'declined', reasonCode: 102, reason: 'Suspected fraud' }),
      ).resolves.toEqual({
        kind: 'declined',
        reasonCodes: ['102'],
        customerMessage: 'Suspected fraud',
      });
      await expect(decideWith({ status: 'declined', reason: '  ' })).resolves.toEqual({
        kind: 'declined',
        reasonCodes: undefined,
        customerMessage: undefined,
      });
    });

    it('maps resubmission_requested to the identity step', async () => {
      await expect(
        decideWith({ status: 'resubmission_requested', reasonCode: 105, reason: 'Blurry' }),
      ).resolves.toEqual({
        kind: 'resubmission',
        target: 'IDENTITY',
        limitExceeded: false,
        reasonCodes: ['105'],
        customerMessage: 'Blurry',
      });
    });

    it.each([202, 208, 214])('sends face reason code %s back to the selfie', async (code) => {
      await expect(
        decideWith({ status: 'resubmission_requested', reasonCode: code }),
      ).resolves.toMatchObject({ kind: 'resubmission', target: 'SELFIE' });
    });

    it('flags reason code 539 as the resubmission limit', async () => {
      await expect(
        decideWith({ status: 'resubmission_requested', reasonCode: 539 }),
      ).resolves.toMatchObject({ kind: 'resubmission', limitExceeded: true });
    });

    it.each(['expired', 'abandoned'])(
      'maps %s to a resubmission of the identity',
      async (status) => {
        await expect(decideWith({ status })).resolves.toEqual({
          kind: 'resubmission',
          target: 'IDENTITY',
        });
      },
    );

    it('throws on an unknown status without echoing the reason', async () => {
      const error = await decideWith({
        status: 'mystery',
        code: 9999,
        reason: 'secret analyst note',
        person: { lastName: 'Kowalski' },
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(VeriffDecisionUnrecognisedStateError);
      expect((error as Error).message).toContain('mystery');
      expect((error as Error).message).toContain('9999');
      expect((error as Error).message).not.toMatch(/secret analyst note|Kowalski/);
    });
  });
});
