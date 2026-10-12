import { Logger } from '@nestjs/common';
import { ConnectorCallbackAlreadyAppliedError } from '../../../errors/connector-callback-already-applied.error';
import { ConnectorPayloadFieldNotFoundError } from '../../../errors/connector-payload-field-not-found.error';
import { PendingConnectorReconcileUnsupportedException } from '../../../errors/pending-connector-reconcile-unsupported.exception';
import type {
  ConnectorCallbackMappingInput,
  ConnectorExecutionInput,
} from '../../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../../ports/connector-execution-result';
import { KycConfigInvalidError } from './kyc-config';
import { KycConnector } from './kyc-connector';
import {
  type KycCallbackEvent,
  KycDocumentUnsupportedError,
  type KycProvider,
  type KycVerdict,
} from './kyc-provider.port';

const CONNECTOR_ID = 'fake_kyc';
const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';

const CONFIG: Readonly<Record<string, unknown>> = {
  sourceKey: 'source',
  documents: [
    {
      payloadField: 'idFrontDocumentId',
      idDocSetType: 'IDENTITY',
      idDocType: 'ID_CARD',
      idDocSubType: 'FRONT_SIDE',
      country: 'PL',
    },
  ],
  maxAttemptsPerDocSet: 3,
  vendorKey: 'vendor-value',
};

const PAYLOAD: Readonly<Record<string, unknown>> = {
  firstName: 'Jan',
  lastName: 'Kowalski',
  dateOfBirth: '1990-01-01',
  nationality: 'PL',
  country: 'PL',
  idFrontDocumentId: 'document-1',
};

const IDENTITY_FIELD_MAPPING: Readonly<Record<string, string>> = {
  firstName: 'firstName',
  lastName: 'lastName',
  dateOfBirth: 'dateOfBirth',
  nationality: 'nationality',
  country: 'country',
};

const createInput = (
  payload: Readonly<Record<string, unknown>> = PAYLOAD,
): ConnectorExecutionInput => ({
  declaration: { order: 1, config: CONFIG },
  execution: { onboardingId: ONBOARDING_ID, stepName: 'kyc' },
  context: {},
  payload,
  payloadFieldSources: {},
});

const createCallbackInput = (): ConnectorCallbackMappingInput => ({
  rawBody: new TextEncoder().encode('{}'),
  headers: {},
});

const APPROVED: KycVerdict = {
  kind: 'approved',
  verifiedIdentity: { lastName: 'Kowalski', dateOfBirth: '1990-01-01' },
};

type FakeProvider = jest.Mocked<KycProvider> & { countsAttempts: boolean };

const createProvider = (): FakeProvider => ({
  id: CONNECTOR_ID,
  name: 'Fake KYC',
  settingsSchema: { fields: [{ key: 'apiKey', secret: false, required: true }] },
  callbackAuth: {
    kind: 'hmac',
    algorithm: 'sha256',
    signatureHeader: 'x-signature',
    encoding: 'hex',
  },
  countsAttempts: false,
  validateConfig: jest.fn(),
  submit: jest.fn().mockResolvedValue({ providerReference: 'reference-1' }),
  parseCallback: jest.fn().mockReturnValue({
    onboardingId: ONBOARDING_ID,
    providerReference: 'reference-1',
    actionable: true,
  } satisfies KycCallbackEvent),
  buildReconcileEvent: jest.fn((reference) => ({ ...reference, actionable: true })),
  fetchVerdict: jest.fn().mockResolvedValue(APPROVED),
  onRetry: jest.fn().mockResolvedValue(undefined),
});

const createDeps = () => {
  const settings = { find: jest.fn(), get: jest.fn() };
  const matchingOnboarding = {
    id: ONBOARDING_ID,
    currentStep: 'kyc',
    context: { ...PAYLOAD },
  };

  return {
    provider: createProvider(),
    settings,
    connectorSettingsService: { resolve: jest.fn().mockResolvedValue(settings) },
    documentResolver: {
      resolve: jest.fn().mockResolvedValue({
        finalObjectKey: 'onboardings/o/document-1/final',
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: 128,
        contentType: 'image/png',
      }),
    },
    objectStoragePort: { readObject: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3])) },
    awaitingCallbackConnectorResolver: {
      findConnector: jest.fn().mockResolvedValue({
        connectorOrder: 1,
        onboarding: matchingOnboarding,
        connector: {
          id: CONNECTOR_ID,
          order: 1,
          config: CONFIG,
          fieldMapping: IDENTITY_FIELD_MAPPING,
        },
        pendingConnector: {
          connectorName: 'Fake KYC',
          connectorId: CONNECTOR_ID,
          connectorOrder: 1,
          providerReference: 'reference-1',
          parkedAt: '2026-10-08T10:00:00.000Z',
        },
      }),
    },
    matchingOnboarding,
  };
};

class FakeKycConnector extends KycConnector {}

const createConnector = (deps: ReturnType<typeof createDeps>) =>
  new FakeKycConnector(
    deps.provider,
    deps.connectorSettingsService as never,
    deps.documentResolver as never,
    deps.objectStoragePort as never,
    deps.awaitingCallbackConnectorResolver as never,
  );

const loggedLines = (spy: jest.SpyInstance, prefix: string): string[] =>
  spy.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith(prefix));

describe('KycConnector', () => {
  it('takes its identity from the provider and declares an async KYC callback', () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    expect(connector).toMatchObject({
      id: CONNECTOR_ID,
      name: 'Fake KYC',
      type: 'kyc',
      supportsAsyncCallback: true,
      callbackAuth: deps.provider.callbackAuth,
      settingsSchema: deps.provider.settingsSchema,
    });
  });

  describe('callbackFields', () => {
    it('declares the four kyc fields plus the attempt count when the provider does not count', () => {
      const deps = createDeps();
      deps.provider.countsAttempts = false;

      expect(createConnector(deps).callbackFields).toEqual([
        'kycOutcome',
        'kycRetryStep',
        'kycReasonCodes',
        'kycCustomerMessage',
        'kycAttemptCount',
      ]);
    });

    it('leaves the attempt count out when the provider counts attempts itself', () => {
      const deps = createDeps();
      deps.provider.countsAttempts = true;

      expect(createConnector(deps).callbackFields).toEqual([
        'kycOutcome',
        'kycRetryStep',
        'kycReasonCodes',
        'kycCustomerMessage',
      ]);
    });
  });

  describe('validateDeclaration', () => {
    const declaration = (config: Record<string, unknown>, fieldMapping: Record<string, string>) =>
      ({ id: CONNECTOR_ID, order: 1, fieldMapping, optionalFieldMapping: {}, config }) as never;

    it('hands the unconsumed keys and the parsed config to the provider', () => {
      const deps = createDeps();

      createConnector(deps).validateDeclaration(
        declaration({ ...CONFIG }, { idFrontDocumentId: 'identityDocument' }),
      );

      expect(deps.provider.validateConfig).toHaveBeenCalledWith(
        { vendorKey: 'vendor-value' },
        expect.objectContaining({ sourceKey: 'source' }),
      );
    });

    it('fails startup when a document key is missing from fieldMapping', () => {
      const connector = createConnector(createDeps());

      expect(() => connector.validateDeclaration(declaration({ ...CONFIG }, {}))).toThrow(
        KycConfigInvalidError,
      );
    });

    it('fails startup when a countryField is missing from fieldMapping', () => {
      const connector = createConnector(createDeps());
      const documents = [
        { ...(CONFIG.documents as object[])[0], country: undefined, countryField: 'issuer' },
      ];

      expect(() =>
        connector.validateDeclaration(
          declaration({ ...CONFIG, documents }, { idFrontDocumentId: 'identityDocument' }),
        ),
      ).toThrow(/"issuer"/);
    });

    it('lets a provider rejection through', () => {
      const deps = createDeps();
      deps.provider.validateConfig.mockImplementation(() => {
        throw new KycConfigInvalidError(CONNECTOR_ID, 'vendorKey', 'must be set');
      });

      expect(() =>
        createConnector(deps).validateDeclaration(
          declaration({ ...CONFIG }, { idFrontDocumentId: 'identityDocument' }),
        ),
      ).toThrow(/vendorKey/);
    });
  });

  describe('execute', () => {
    it('submits and answers accepted() carrying the provider reference', async () => {
      const deps = createDeps();

      const result = await createConnector(deps).execute(createInput());

      expect(result).toEqual(
        ConnectorExecutionResult.accepted({ providerReference: 'reference-1' }),
      );
      expect(result.isPending()).toBe(false);
    });

    it('resolves the settings for this connector and passes them with the submission', async () => {
      const deps = createDeps();
      const connector = createConnector(deps);

      await connector.execute(createInput());

      expect(deps.connectorSettingsService.resolve).toHaveBeenCalledWith(connector);
      expect(deps.provider.submit).toHaveBeenCalledWith(
        deps.settings,
        expect.objectContaining({
          onboardingId: ONBOARDING_ID,
          sourceKey: 'source',
          providerConfig: { vendorKey: 'vendor-value' },
          applicant: expect.objectContaining({ lastName: 'Kowalski' }),
          documents: [expect.objectContaining({ documentId: 'document-1', country: 'PL' })],
        }),
      );
    });

    it('reads the documents before the provider is called', async () => {
      const deps = createDeps();
      const order: string[] = [];
      deps.objectStoragePort.readObject.mockImplementation(async () => {
        order.push('readObject');
        return Buffer.from([1]);
      });
      deps.provider.submit.mockImplementation(async () => {
        order.push('submit');
        return { providerReference: 'reference-1' };
      });

      await createConnector(deps).execute(createInput());

      expect(order).toEqual(['readObject', 'submit']);
    });

    it('answers invalid() without calling the provider when a document fails to resolve', async () => {
      const deps = createDeps();
      deps.documentResolver.resolve.mockResolvedValueOnce(undefined);

      const result = await createConnector(deps).execute(createInput());

      expect(result).toEqual(ConnectorExecutionResult.invalid());
      expect(deps.provider.submit).not.toHaveBeenCalled();
    });

    it('answers invalid() without calling the provider when no document was supplied', async () => {
      const deps = createDeps();
      const documents = [{ ...(CONFIG.documents as object[])[0], optional: true }];
      const input = {
        ...createInput({ ...PAYLOAD, idFrontDocumentId: undefined }),
        declaration: { order: 1, config: { ...CONFIG, documents } },
      };

      const result = await createConnector(deps).execute(input);

      expect(result).toEqual(ConnectorExecutionResult.invalid());
      expect(deps.provider.submit).not.toHaveBeenCalled();
    });

    it('answers retryable invalid-data on the document field when the provider cannot take the document', async () => {
      const deps = createDeps();
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      deps.provider.submit.mockImplementation(async (_settings, submission) => {
        throw new KycDocumentUnsupportedError(CONNECTOR_ID, submission.documents[0]);
      });

      const result = await createConnector(deps).execute(
        createInput({ ...PAYLOAD, idFrontDocumentId: 'document-1' }),
      );

      expect(result).toEqual(
        ConnectorExecutionResult.invalidData(
          { idFrontDocumentId: ['UNSUPPORTED_CONTENT_TYPE'] },
          { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
        ),
      );
      expect(loggedLines(logSpy, 'KYC_DOCUMENT_UNSUPPORTED')).toEqual([
        `KYC_DOCUMENT_UNSUPPORTED connectorId=${CONNECTOR_ID} onboardingId=${ONBOARDING_ID} ` +
          'field=idFrontDocumentId contentType=image/png',
      ]);
    });

    it('lets a provider failure propagate', async () => {
      const deps = createDeps();
      const failure = new Error('provider unavailable');
      deps.provider.submit.mockRejectedValueOnce(failure);

      await expect(createConnector(deps).execute(createInput())).rejects.toThrow(failure);
    });

    it('never issues a delete against object storage', async () => {
      const deps = createDeps();

      await createConnector(deps).execute(createInput());

      expect(Object.keys(deps.objectStoragePort)).toEqual(['readObject']);
    });
  });

  describe('reconcilePending', () => {
    it('asks the provider through its reconcile event and answers the callback a webhook would carry', async () => {
      const deps = createDeps();

      const reconciled = await createConnector(deps).reconcilePending({
        onboardingId: ONBOARDING_ID,
      });

      expect(deps.provider.buildReconcileEvent).toHaveBeenCalledWith({
        onboardingId: ONBOARDING_ID,
        providerReference: 'reference-1',
      });
      expect(deps.provider.parseCallback).not.toHaveBeenCalled();
      expect(reconciled.outcome).toBe('resolved');
      if (reconciled.outcome !== 'resolved') {
        throw new Error('unreachable');
      }
      expect(reconciled.callback.onboardingId).toBe(ONBOARDING_ID);
      expect(reconciled.callback.submittedData).toEqual({ kycOutcome: 'verified' });
      expect(reconciled.callback.resolvedConnector.pendingConnector).toMatchObject({
        providerReference: 'reference-1',
      });
    });

    it('answers still_pending when the provider has not decided', async () => {
      const deps = createDeps();
      deps.provider.fetchVerdict.mockResolvedValueOnce({ kind: 'pending' });

      await expect(
        createConnector(deps).reconcilePending({ onboardingId: ONBOARDING_ID }),
      ).resolves.toEqual({ outcome: 'still_pending' });
    });

    it('refuses a park that records no provider attempt', async () => {
      const deps = createDeps();
      deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue({
        connectorOrder: 1,
        onboarding: deps.matchingOnboarding,
        connector: {
          id: CONNECTOR_ID,
          order: 1,
          config: CONFIG,
          fieldMapping: IDENTITY_FIELD_MAPPING,
        },
        pendingConnector: {
          connectorName: 'Fake KYC',
          connectorId: CONNECTOR_ID,
          connectorOrder: 1,
        },
      });

      await expect(
        createConnector(deps).reconcilePending({ onboardingId: ONBOARDING_ID }),
      ).rejects.toBeInstanceOf(PendingConnectorReconcileUnsupportedException);
      expect(deps.provider.fetchVerdict).not.toHaveBeenCalled();
    });

    it('reports an onboarding no longer parked as already applied', async () => {
      const deps = createDeps();
      deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue(undefined);

      await expect(
        createConnector(deps).reconcilePending({ onboardingId: ONBOARDING_ID }),
      ).rejects.toBeInstanceOf(ConnectorCallbackAlreadyAppliedError);
    });

    it('logs the outcome with ids only', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const deps = createDeps();

      await createConnector(deps).reconcilePending({ onboardingId: ONBOARDING_ID });

      expect(loggedLines(log, 'KYC_RECONCILE')).toEqual([
        `KYC_RECONCILE connectorId=${CONNECTOR_ID} onboardingId=${ONBOARDING_ID} outcome=resolved`,
      ]);
    });
  });

  describe('mapCallbackResult', () => {
    it('applies an approved verdict as verified', async () => {
      const deps = createDeps();

      const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

      expect(result.onboardingId).toBe(ONBOARDING_ID);
      expect(result.result.isAccepted()).toBe(true);
      expect(result.submittedData).toEqual({ kycOutcome: 'verified' });
      expect(deps.provider.parseCallback).toHaveBeenCalledWith(
        createCallbackInput(),
        deps.settings,
      );
    });

    it('correlates by the event onboarding id and this connector id', async () => {
      const deps = createDeps();

      await createConnector(deps).mapCallbackResult(createCallbackInput());

      expect(deps.awaitingCallbackConnectorResolver.findConnector).toHaveBeenCalledWith({
        onboardingId: ONBOARDING_ID,
        connectorId: CONNECTOR_ID,
      });
    });

    it('awaits an asynchronous parseCallback', async () => {
      const deps = createDeps();
      deps.provider.parseCallback.mockResolvedValue({
        onboardingId: ONBOARDING_ID,
        actionable: true,
      });

      const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

      expect(result.submittedData).toEqual({ kycOutcome: 'verified' });
    });

    describe('correlation', () => {
      it('treats an onboarding id that is not a UUID as already applied, never reaching the resolver', async () => {
        const deps = createDeps();
        deps.provider.parseCallback.mockReturnValue({
          onboardingId: 'not-a-uuid',
          actionable: true,
        });

        await expect(
          createConnector(deps).mapCallbackResult(createCallbackInput()),
        ).rejects.toThrow(ConnectorCallbackAlreadyAppliedError);
        expect(deps.awaitingCallbackConnectorResolver.findConnector).not.toHaveBeenCalled();
        expect(deps.provider.fetchVerdict).not.toHaveBeenCalled();
      });

      it('throws ConnectorCallbackAlreadyAppliedError for a redelivery once the step has advanced', async () => {
        const deps = createDeps();
        deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue(undefined);

        await expect(
          createConnector(deps).mapCallbackResult(createCallbackInput()),
        ).rejects.toThrow(ConnectorCallbackAlreadyAppliedError);
        expect(deps.provider.fetchVerdict).not.toHaveBeenCalled();
      });

      it('re-parks a non-actionable event without reading a verdict', async () => {
        const deps = createDeps();
        deps.provider.parseCallback.mockReturnValue({
          onboardingId: ONBOARDING_ID,
          actionable: false,
        });

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.result.isPending()).toBe(true);
        expect(result.result.pending).toEqual({
          connectorName: 'Fake KYC',
          connectorId: CONNECTOR_ID,
          connectorOrder: 1,
          providerReference: 'reference-1',
          parkedAt: '2026-10-08T10:00:00.000Z',
        });
        expect(result.submittedData).toEqual({});
        expect(deps.provider.fetchVerdict).not.toHaveBeenCalled();
      });

      it('re-parks on a pending verdict', async () => {
        const deps = createDeps();
        deps.provider.fetchVerdict.mockResolvedValue({ kind: 'pending' });

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.result.isPending()).toBe(true);
        expect(result.submittedData).toEqual({});
        expect(deps.provider.onRetry).not.toHaveBeenCalled();
      });
    });

    describe('the stale-reference guard', () => {
      const parkedOn = (deps: ReturnType<typeof createDeps>, providerReference?: string) => {
        const pendingConnector = {
          connectorName: 'Fake KYC',
          connectorId: CONNECTOR_ID,
          connectorOrder: 1,
          ...(providerReference === undefined ? {} : { providerReference }),
        };
        deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue({
          connectorOrder: 1,
          onboarding: deps.matchingOnboarding,
          connector: {
            id: CONNECTOR_ID,
            order: 1,
            config: CONFIG,
            fieldMapping: IDENTITY_FIELD_MAPPING,
          },
          pendingConnector,
        });

        return pendingConnector;
      };

      it('re-parks, keeping the parked reference, and logs ids only when the event is for another session', async () => {
        const deps = createDeps();
        const pendingConnector = parkedOn(deps, 'session-current');
        deps.provider.parseCallback.mockReturnValue({
          onboardingId: ONBOARDING_ID,
          providerReference: 'session-old',
          actionable: true,
        });
        const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.result.isPending()).toBe(true);
        expect(result.result.pending).toEqual(pendingConnector);
        expect(result.submittedData).toEqual({});
        expect(deps.provider.fetchVerdict).not.toHaveBeenCalled();
        expect(loggedLines(log, 'KYC_CALLBACK_SUPERSEDED')).toEqual([
          `KYC_CALLBACK_SUPERSEDED connectorId=${CONNECTOR_ID} onboardingId=${ONBOARDING_ID}`,
        ]);
      });

      it('decides normally when the event carries the parked reference', async () => {
        const deps = createDeps();
        parkedOn(deps, 'reference-1');

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(deps.provider.fetchVerdict).toHaveBeenCalledTimes(1);
        expect(result.result.isAccepted()).toBe(true);
      });

      it.each([
        ['the parked record has no reference', undefined, 'reference-1'],
        ['the event carries none', 'session-current', undefined],
      ])('decides normally when %s', async (_case, parked, eventReference) => {
        const deps = createDeps();
        parkedOn(deps, parked);
        deps.provider.parseCallback.mockReturnValue({
          onboardingId: ONBOARDING_ID,
          providerReference: eventReference,
          actionable: true,
        });

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(deps.provider.fetchVerdict).toHaveBeenCalledTimes(1);
        expect(result.result.isAccepted()).toBe(true);
      });

      it('keeps the parked reference when an acknowledged event re-parks', async () => {
        const deps = createDeps();
        const pendingConnector = parkedOn(deps, 'reference-1');
        deps.provider.parseCallback.mockReturnValue({
          onboardingId: ONBOARDING_ID,
          actionable: false,
        });

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.result.pending).toEqual(pendingConnector);
      });
    });

    it('hands the provider the event and the parsed config, provider config and onboarding context', async () => {
      const deps = createDeps();

      await createConnector(deps).mapCallbackResult(createCallbackInput());

      expect(deps.provider.fetchVerdict).toHaveBeenCalledWith(
        deps.settings,
        expect.objectContaining({ providerReference: 'reference-1' }),
        {
          config: expect.objectContaining({ sourceKey: 'source', maxAttemptsPerDocSet: 3 }),
          providerConfig: { vendorKey: 'vendor-value' },
          onboardingContext: deps.matchingOnboarding.context,
        },
      );
    });

    describe('the identity guard', () => {
      it('resolves the declared identity through the connector fieldMapping, not the context field names', async () => {
        const deps = createDeps();
        const contextWithoutLastName: Record<string, unknown> = {
          ...deps.matchingOnboarding.context,
        };
        delete contextWithoutLastName.lastName;
        deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue({
          connectorOrder: 1,
          onboarding: {
            ...deps.matchingOnboarding,
            context: { ...contextWithoutLastName, surname: 'Kowalski' },
          },
          connector: {
            id: CONNECTOR_ID,
            order: 1,
            config: CONFIG,
            fieldMapping: { ...IDENTITY_FIELD_MAPPING, lastName: 'surname' },
          },
        });

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.submittedData).toEqual({ kycOutcome: 'verified' });
      });

      it('fails when the fieldMapping names a context field that is not there', async () => {
        const deps = createDeps();
        deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue({
          connectorOrder: 1,
          onboarding: deps.matchingOnboarding,
          connector: {
            id: CONNECTOR_ID,
            order: 1,
            config: CONFIG,
            fieldMapping: { ...IDENTITY_FIELD_MAPPING, lastName: 'surname' },
          },
        });

        await expect(
          createConnector(deps).mapCallbackResult(createCallbackInput()),
        ).rejects.toThrow(ConnectorPayloadFieldNotFoundError);
      });

      it.each([
        ['a different last name', { lastName: 'Nowak', dateOfBirth: '1990-01-01' }, 'mismatch'],
        ['no verified identity', undefined, 'no-verified-data'],
      ])(
        'sends an approval with %s to human_review and logs the kind and fields only',
        async (_label, verifiedIdentity, kind) => {
          const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
          const deps = createDeps();
          deps.provider.fetchVerdict.mockResolvedValue({ kind: 'approved', verifiedIdentity });

          const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

          expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });
          const lines = loggedLines(logSpy, 'KYC_IDENTITY_GUARD_FIRED');
          expect(lines).toHaveLength(1);
          expect(lines[0]).toContain(`connectorId=${CONNECTOR_ID}`);
          expect(lines[0]).toContain(`onboardingId=${ONBOARDING_ID}`);
          expect(lines[0]).toContain(`mismatchKind=${kind}`);
          expect(lines[0]).not.toContain('Kowalski');
          expect(lines[0]).not.toContain('Nowak');
          expect(lines[0]).not.toContain('1990-01-01');
        },
      );
    });

    describe('verdict to submittedData', () => {
      it('applies needs_review as human_review and logs the reason and counts', async () => {
        const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        const deps = createDeps();
        deps.provider.fetchVerdict.mockResolvedValue({
          kind: 'needs_review',
          reason: 'screening_unresolved',
          detail: { hitCount: 2 },
        });

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });
        const lines = loggedLines(logSpy, 'KYC_NEEDS_REVIEW');
        expect(lines).toEqual([
          `KYC_NEEDS_REVIEW connectorId=${CONNECTOR_ID} onboardingId=${ONBOARDING_ID} ` +
            'reason=screening_unresolved hitCount=2',
        ]);
      });

      it('applies a decline as refused with the reason codes and customer message', async () => {
        const deps = createDeps();
        deps.provider.fetchVerdict.mockResolvedValue({
          kind: 'declined',
          reasonCodes: ['FORGERY'],
          customerMessage: 'Document looks altered',
        });

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.submittedData).toEqual({
          kycOutcome: 'refused',
          kycReasonCodes: ['FORGERY'],
          kycCustomerMessage: 'Document looks altered',
        });
        expect(deps.provider.onRetry).not.toHaveBeenCalled();
      });

      it('submits only the closed set of fields, whatever else the verdict carried', async () => {
        const deps = createDeps();
        deps.provider.fetchVerdict.mockResolvedValue({
          kind: 'declined',
          reasonCodes: ['FORGERY'],
          customerMessage: 'No',
          clientComment: 'internal analyst note',
        } as never);

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(Object.keys(result.submittedData as object).sort()).toEqual([
          'kycCustomerMessage',
          'kycOutcome',
          'kycReasonCodes',
        ]);
        expect(JSON.stringify(result.submittedData)).not.toContain('internal analyst note');
      });
    });

    describe('a resubmission', () => {
      const resubmission: KycVerdict = {
        kind: 'resubmission',
        target: 'SELFIE',
        reasonCodes: ['BAD_SELFIE'],
      };

      it('applies the retry, calls onRetry with the target before returning, and logs it', async () => {
        const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        const deps = createDeps();
        deps.provider.fetchVerdict.mockResolvedValue(resubmission);

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(deps.provider.onRetry).toHaveBeenCalledTimes(1);
        expect(deps.provider.onRetry).toHaveBeenCalledWith(
          deps.settings,
          expect.objectContaining({ providerReference: 'reference-1' }),
          'SELFIE',
        );
        expect(result.submittedData).toMatchObject({
          kycOutcome: 'retry',
          kycRetryStep: 'SELFIE',
          kycReasonCodes: ['BAD_SELFIE'],
        });
        expect(loggedLines(logSpy, 'KYC_RETRY')).toEqual([
          `KYC_RETRY connectorId=${CONNECTOR_ID} onboardingId=${ONBOARDING_ID} ` +
            'target=SELFIE attempts=1 maxAttemptsPerDocSet=3',
        ]);
      });

      it('tolerates a provider with no onRetry', async () => {
        const deps = createDeps();
        delete (deps.provider as { onRetry?: unknown }).onRetry;
        deps.provider.fetchVerdict.mockResolvedValue(resubmission);

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.submittedData).toMatchObject({ kycOutcome: 'retry' });
      });

      it('writes kycAttemptCount, counted from the onboarding, when the provider does not count', async () => {
        const deps = createDeps();
        deps.matchingOnboarding.context = { ...PAYLOAD, kycAttemptCount: 1 };
        deps.provider.fetchVerdict.mockResolvedValue(resubmission);

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.submittedData).toMatchObject({ kycOutcome: 'retry', kycAttemptCount: 2 });
      });

      it.each([
        ['absent', {}],
        ['not a number', { kycAttemptCount: '2' }],
      ])('counts from zero when kycAttemptCount is %s', async (_label, extra) => {
        const deps = createDeps();
        deps.matchingOnboarding.context = { ...PAYLOAD, ...extra };
        deps.provider.fetchVerdict.mockResolvedValue(resubmission);

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.submittedData).toMatchObject({ kycAttemptCount: 1 });
      });

      it('never writes kycAttemptCount when the provider counts attempts itself', async () => {
        const deps = createDeps();
        deps.provider.countsAttempts = true;
        deps.provider.fetchVerdict.mockResolvedValue({ ...resubmission, attemptCount: 1 });

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.submittedData).not.toHaveProperty('kycAttemptCount');
      });

      it('hands over to human_review at the cap, logs it, and does not call onRetry', async () => {
        const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        const deps = createDeps();
        deps.matchingOnboarding.context = { ...PAYLOAD, kycAttemptCount: 2 };
        deps.provider.fetchVerdict.mockResolvedValue(resubmission);

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });
        expect(deps.provider.onRetry).not.toHaveBeenCalled();
        expect(loggedLines(logSpy, 'KYC_ATTEMPTS_EXHAUSTED')).toEqual([
          `KYC_ATTEMPTS_EXHAUSTED connectorId=${CONNECTOR_ID} onboardingId=${ONBOARDING_ID} ` +
            'target=SELFIE attempts=3 maxAttemptsPerDocSet=3',
        ]);
      });

      it('honours the provider’s limitExceeded below the cap', async () => {
        const deps = createDeps();
        deps.provider.fetchVerdict.mockResolvedValue({
          ...resubmission,
          limitExceeded: true,
        } as never);

        const result = await createConnector(deps).mapCallbackResult(createCallbackInput());

        expect(result.submittedData).toEqual({ kycOutcome: 'human_review' });
      });
    });

    it('carries the park it correlated against on the outcome and on a re-park, time included', async () => {
      const deps = createDeps();

      const outcome = await createConnector(deps).mapCallbackResult(createCallbackInput());
      expect(outcome.resolvedConnector.pendingConnector).toMatchObject({
        providerReference: 'reference-1',
        parkedAt: '2026-10-08T10:00:00.000Z',
      });

      deps.provider.fetchVerdict.mockResolvedValueOnce({ kind: 'pending' });
      const parked = await createConnector(deps).mapCallbackResult(createCallbackInput());
      expect(parked.result.pending).toEqual({
        connectorName: 'Fake KYC',
        connectorId: CONNECTOR_ID,
        connectorOrder: 1,
        providerReference: 'reference-1',
        parkedAt: '2026-10-08T10:00:00.000Z',
      });
    });

    it('lets an unmappable provider state propagate so the callback answers 5xx', async () => {
      const deps = createDeps();
      const failure = new Error('unrecognised state');
      deps.provider.fetchVerdict.mockRejectedValueOnce(failure);

      await expect(createConnector(deps).mapCallbackResult(createCallbackInput())).rejects.toThrow(
        failure,
      );
    });

    it('logs an acknowledged event at debug with ids only', async () => {
      const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      const deps = createDeps();
      deps.provider.parseCallback.mockReturnValue({
        onboardingId: ONBOARDING_ID,
        providerReference: 'reference-1',
        actionable: false,
        hint: 'event_only',
      });

      await createConnector(deps).mapCallbackResult(createCallbackInput());

      expect(loggedLines(debugSpy, 'KYC_CALLBACK_ACKNOWLEDGED')).toEqual([
        `KYC_CALLBACK_ACKNOWLEDGED connectorId=${CONNECTOR_ID} onboardingId=${ONBOARDING_ID}`,
      ]);
    });
  });
});
