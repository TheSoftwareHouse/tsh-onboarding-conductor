import { VeriffKycConnector } from './veriff-kyc.connector';
import {
  VeriffCallbackAuthClientMismatchError,
  VeriffKycProvider,
} from './veriff-kyc/veriff-kyc.provider';
import type { VeriffMediaFitter } from './veriff-kyc/veriff-media-fitter';
import { KycConfigInvalidError } from './kyc/kyc-config';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';
import type {
  ConnectorCallbackMappingInput,
  ConnectorExecutionInput,
} from '../../ports/connector-adapter.port';

// The seam between the KYC kernel and the Veriff provider, driven end to end with a mocked
// `VeriffClient`. The kernel's own rules live in `kyc/kyc-connector.spec.ts` and the decision
// mapping in `veriff-kyc/veriff-kyc.provider.spec.ts`; this file only pins what neither can see
// alone — what the kernel hands Veriff and what a Veriff answer becomes once the kernel applies it.

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';

const VALID_CONFIG: Readonly<Record<string, unknown>> = {
  sourceKey: 'veriff',
  documents: [
    {
      payloadField: 'idFrontDocumentId',
      idDocSetType: 'IDENTITY',
      idDocType: 'ID_CARD',
      idDocSubType: 'FRONT_SIDE',
      // Alpha-3 on purpose: the kernel normalises to alpha-2 before Veriff sees it.
      country: 'POL',
    },
    {
      payloadField: 'selfieDocumentId',
      idDocSetType: 'SELFIE',
      idDocType: 'SELFIE',
      country: 'POL',
    },
  ],
  maxAttemptsPerDocSet: 3,
};

const VALID_PAYLOAD: Readonly<Record<string, unknown>> = {
  firstName: 'Jan',
  lastName: 'Kowalski',
  dateOfBirth: '1990-01-01',
  nationality: 'PL',
  country: 'PL',
  idFrontDocumentId: 'document-1',
  selfieDocumentId: 'document-2',
};

const IDENTITY_FIELD_MAPPING: Readonly<Record<string, string>> = {
  firstName: 'firstName',
  lastName: 'lastName',
  dateOfBirth: 'dateOfBirth',
  nationality: 'nationality',
  country: 'country',
  idFrontDocumentId: 'idFrontDocumentId',
  selfieDocumentId: 'selfieDocumentId',
};

const createInput = (): ConnectorExecutionInput => ({
  declaration: { order: 1, config: VALID_CONFIG },
  execution: { onboardingId: ONBOARDING_ID, stepName: 'kyc' },
  context: {},
  payload: VALID_PAYLOAD,
  payloadFieldSources: {},
});

const AUTH_HEADERS: Readonly<Record<string, string | undefined>> = {
  'x-auth-client': 'api-key-1',
};

const encode = (record: Record<string, unknown>): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(record));

const decisionCallback = (
  verification: Record<string, unknown> = {},
  headers = AUTH_HEADERS,
): ConnectorCallbackMappingInput => ({
  rawBody: encode({
    status: 'success',
    verification: {
      id: 'session-1',
      vendorData: ONBOARDING_ID,
      status: 'approved',
      ...verification,
    },
  }),
  headers,
});

const eventCallback = (): ConnectorCallbackMappingInput => ({
  rawBody: encode({ status: 'success', action: 'started', vendorData: ONBOARDING_ID }),
  headers: AUTH_HEADERS,
});

const createDeps = () => {
  const veriffClient = {
    createSession: jest.fn().mockResolvedValue({ id: 'session-1', status: 'created' }),
    uploadMedia: jest.fn().mockResolvedValue('image-1'),
    submitSession: jest.fn().mockResolvedValue(undefined),
    findDecision: jest.fn().mockResolvedValue({
      id: 'session-1',
      status: 'approved',
      vendorData: ONBOARDING_ID,
      person: { lastName: 'Kowalski', dateOfBirth: '1990-01-01' },
    }),
  };
  const settings = {
    find: jest.fn(),
    get: (key: string) =>
      key === 'apiKey' ? 'api-key-1' : key === 'sharedSecretKey' ? 'secret-1' : undefined,
  };
  const matchingOnboarding = {
    id: ONBOARDING_ID,
    workflowId: 'workflow-1',
    workflowVersion: 1,
    currentStep: 'kyc',
    context: { ...VALID_PAYLOAD } as Record<string, unknown>,
  };
  const resolution = {
    connectorOrder: 1,
    onboarding: matchingOnboarding,
    connector: {
      id: 'veriff_kyc',
      order: 1,
      config: VALID_CONFIG,
      fieldMapping: IDENTITY_FIELD_MAPPING,
    },
    pendingConnector: {
      connectorId: 'veriff_kyc',
      connectorName: 'veriff_kyc',
      connectorOrder: 1,
      providerReference: 'session-1',
    } as Record<string, unknown>,
  };

  return {
    veriffClient,
    settings,
    matchingOnboarding,
    resolution,
    connectorSettingsService: { resolve: jest.fn().mockResolvedValue(settings) },
    documentResolver: {
      resolve: jest.fn().mockImplementation(async ({ documentId }: { documentId: string }) => ({
        finalObjectKey: `onboardings/${ONBOARDING_ID}/${documentId}/final`,
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: 128,
        contentType: documentId === 'document-2' ? 'image/jpeg' : 'image/png',
      })),
    },
    objectStoragePort: { readObject: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3])) },
    awaitingCallbackConnectorResolver: { findConnector: jest.fn().mockResolvedValue(resolution) },
  };
};

/** The fixture documents are not real images, so the fitter must not hand them to sharp. */
const passThroughFitter = { fit: async (document) => document } as VeriffMediaFitter;

const createConnector = (deps: ReturnType<typeof createDeps>) =>
  new VeriffKycConnector(
    new VeriffKycProvider(deps.veriffClient as never, passThroughFitter),
    deps.connectorSettingsService as never,
    deps.documentResolver as never,
    deps.objectStoragePort as never,
    deps.awaitingCallbackConnectorResolver as never,
  );

describe('VeriffKycConnector', () => {
  it('is veriff_kyc, signs callbacks with sharedSecretKey and lets the kernel count attempts', () => {
    const connector = createConnector(createDeps());

    expect(connector).toMatchObject({
      id: 'veriff_kyc',
      type: 'kyc',
      supportsAsyncCallback: true,
      callbackAuth: expect.objectContaining({
        signatureHeader: 'x-hmac-signature',
        secretSettingKey: 'sharedSecretKey',
      }),
    });
    expect(connector.callbackFields).toContain('kycAttemptCount');
  });

  it('refuses at boot a document the kernel accepts but Veriff has no media context for', () => {
    const connector = createConnector(createDeps());
    const documents = [{ ...(VALID_CONFIG.documents as object[])[0], idDocSubType: 'LEFT_SIDE' }];

    expect(() =>
      connector.validateDeclaration({
        name: 'veriff_kyc',
        id: 'veriff_kyc',
        type: 'kyc',
        canReject: false,
        order: 1,
        config: { ...VALID_CONFIG, documents },
        fieldMapping: IDENTITY_FIELD_MAPPING,
      } as never),
    ).toThrow(KycConfigInvalidError);
  });

  describe('execute', () => {
    it('opens a fresh session per call, uploads every captured image to it and submits it', async () => {
      const deps = createDeps();
      deps.veriffClient.createSession
        .mockResolvedValueOnce({ id: 'session-1', status: 'created' })
        .mockResolvedValueOnce({ id: 'session-2', status: 'created' });
      const connector = createConnector(deps);

      const first = await connector.execute(createInput());
      const second = await connector.execute(createInput());

      expect(first).toEqual(ConnectorExecutionResult.accepted({ providerReference: 'session-1' }));
      expect(second).toEqual(ConnectorExecutionResult.accepted({ providerReference: 'session-2' }));
      expect(deps.veriffClient.createSession).toHaveBeenCalledTimes(2);
      expect(deps.veriffClient.uploadMedia.mock.calls.map(([, upload]) => upload)).toEqual([
        expect.objectContaining({
          sessionId: 'session-1',
          context: 'document-front',
          contentType: 'image/png',
        }),
        expect.objectContaining({
          sessionId: 'session-1',
          context: 'face',
          contentType: 'image/jpeg',
        }),
        expect.objectContaining({ sessionId: 'session-2', context: 'document-front' }),
        expect.objectContaining({ sessionId: 'session-2', context: 'face' }),
      ]);
      expect(deps.veriffClient.submitSession).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        'session-1',
      );
      expect(deps.veriffClient.submitSession).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        'session-2',
      );
    });

    it('correlates the session by the onboarding id and prefills the document in alpha-2', async () => {
      const deps = createDeps();

      await createConnector(deps).execute(createInput());

      expect(deps.veriffClient.createSession).toHaveBeenCalledWith(
        { apiKey: 'api-key-1', sharedSecretKey: 'secret-1' },
        expect.objectContaining({
          vendorData: ONBOARDING_ID,
          person: { firstName: 'Jan', lastName: 'Kowalski', dateOfBirth: '1990-01-01' },
          document: { type: 'ID_CARD', country: 'PL' },
        }),
      );
    });
  });

  describe('mapCallbackResult', () => {
    it('rejects a callback whose X-AUTH-CLIENT is not the configured apiKey before correlating', async () => {
      const deps = createDeps();

      await expect(
        createConnector(deps).mapCallbackResult(decisionCallback({}, { 'x-auth-client': 'other' })),
      ).rejects.toThrow(VeriffCallbackAuthClientMismatchError);
      expect(deps.awaitingCallbackConnectorResolver.findConnector).not.toHaveBeenCalled();
      expect(deps.veriffClient.findDecision).not.toHaveBeenCalled();
    });

    it('acknowledges an event webhook by re-parking on the same session, reading no decision', async () => {
      const deps = createDeps();

      const result = await createConnector(deps).mapCallbackResult(eventCallback());

      expect(result.result.isPending()).toBe(true);
      expect(result.result.pending).toMatchObject({
        connectorId: 'veriff_kyc',
        providerReference: 'session-1',
      });
      expect(result.submittedData).toEqual({});
      expect(deps.veriffClient.findDecision).not.toHaveBeenCalled();
    });

    it('re-parks on a review decision read back from the session, keeping the reference', async () => {
      const deps = createDeps();
      deps.veriffClient.findDecision.mockResolvedValue({
        id: 'session-1',
        status: 'review',
        vendorData: ONBOARDING_ID,
      });

      const result = await createConnector(deps).mapCallbackResult(
        decisionCallback({ status: 'review' }),
      );

      expect(deps.veriffClient.findDecision).toHaveBeenCalledWith(expect.anything(), 'session-1');
      expect(result.result.isPending()).toBe(true);
      expect(result.result.pending).toMatchObject({ providerReference: 'session-1' });
      expect(result.submittedData).toEqual({});
    });

    it('ignores a decision for a session the park no longer waits on', async () => {
      const deps = createDeps();

      const result = await createConnector(deps).mapCallbackResult(
        decisionCallback({ id: 'session-0' }),
      );

      expect(result.result.isPending()).toBe(true);
      expect(result.result.pending).toMatchObject({ providerReference: 'session-1' });
      expect(deps.veriffClient.findDecision).not.toHaveBeenCalled();
    });

    it('turns an expired session into retry.IDENTITY with the attempt count the kernel keeps', async () => {
      const deps = createDeps();
      deps.matchingOnboarding.context.kycAttemptCount = 1;
      deps.veriffClient.findDecision.mockResolvedValue({
        id: 'session-1',
        status: 'expired',
        vendorData: ONBOARDING_ID,
      });

      const result = await createConnector(deps).mapCallbackResult(
        decisionCallback({ status: 'expired' }),
      );

      expect(result.result.isAccepted()).toBe(true);
      expect(result.submittedData).toEqual({
        kycOutcome: 'retry',
        kycRetryStep: 'IDENTITY',
        kycAttemptCount: 2,
      });
    });

    it('sends the applicant to human review once the kernel-counted attempts reach the cap', async () => {
      const deps = createDeps();
      deps.matchingOnboarding.context.kycAttemptCount = 2;
      deps.veriffClient.findDecision.mockResolvedValue({
        id: 'session-1',
        status: 'resubmission_requested',
        vendorData: ONBOARDING_ID,
        reasonCode: 202,
      });

      const result = await createConnector(deps).mapCallbackResult(
        decisionCallback({ status: 'resubmission_requested' }),
      );

      expect(result.submittedData).toMatchObject({ kycOutcome: 'human_review' });
      expect(result.submittedData).not.toMatchObject({ kycOutcome: 'retry' });
    });

    it('verifies an approved decision whose person matches what the onboarding declared', async () => {
      const deps = createDeps();

      const result = await createConnector(deps).mapCallbackResult(decisionCallback());

      expect(result.submittedData).toEqual({ kycOutcome: 'verified' });
    });
  });
});
