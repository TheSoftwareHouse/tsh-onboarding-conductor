import { Logger } from '@nestjs/common';
import type { NormalizedWorkflowConnectorFallback } from '@tsh/ddl-schema';
import type {
  ConnectorSettingsService,
  ResolvedConnectorSettings,
} from '../../../connector-settings.service';
import { LeanUnavailableException } from '../../../errors/lean-unavailable.exception';
import type { ConnectorExecutionInput } from '../../../ports/connector-adapter.port';
import { ConnectorExecutionMetadataFlag } from '../../../ports/connector-execution-result';
import type { LeanClient } from './lean-client';
import {
  LEAN_ERROR_STATUS_INVALID_PARAMETERS,
  LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER,
  LEAN_IBAN_VERIFICATION_CONNECTOR_ID,
  LEAN_REJECTION_IBAN_NOT_VERIFIABLE,
  LEAN_REJECTION_IBAN_OWNERSHIP_NOT_VERIFIED,
  type LeanAccountVerification,
} from './lean-contract';
import { LeanIbanVerificationConnector } from './lean-iban-verification.connector';

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';
const IBAN = 'SA0000000000000000000000';
const NATIONAL_ID = '1000000001';
const CLIENT_ID = 'client-id-1';
const CLIENT_SECRET = 'client-secret-1';

const createInput = (
  overrides: Partial<ConnectorExecutionInput> = {},
): ConnectorExecutionInput => ({
  declaration: { order: 0, config: {} },
  execution: { onboardingId: ONBOARDING_ID, stepName: 'verify_iban' },
  context: {},
  payload: { iban: IBAN, nationalId: NATIONAL_ID },
  payloadFieldSources: { iban: 'iban', nationalId: 'nationalId' },
  ...overrides,
});

const verification = (
  overrides: Partial<LeanAccountVerification> = {},
): LeanAccountVerification => ({
  status: 'OK',
  results_id: 'results-1',
  message: 'Verification completed',
  status_detail: null,
  verifications: {
    account_ownership_verified: true,
    matching: null,
    account_status: 'ACTIVE',
    account_holder_name: null,
    verification_method: 'CONFIRMATION_OF_PAYEE_SERVICE',
  },
  ...overrides,
});

const withVerifications = (
  overrides: Partial<NonNullable<LeanAccountVerification['verifications']>>,
): LeanAccountVerification => {
  const base = verification();

  return { ...base, verifications: { ...base.verifications!, ...overrides } };
};

describe('LeanIbanVerificationConnector', () => {
  const verifyAccount = jest.fn();
  const settings: ResolvedConnectorSettings = {
    find: jest.fn(),
    get: jest.fn((key: string) => ({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })[key]),
  };
  const connectorSettingsService = {
    resolve: jest.fn().mockResolvedValue(settings),
  } as unknown as ConnectorSettingsService;
  let connector: LeanIbanVerificationConnector;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    (connectorSettingsService.resolve as jest.Mock).mockResolvedValue(settings);
    (settings.get as jest.Mock).mockImplementation(
      (key: string) => ({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })[key],
    );
    connector = new LeanIbanVerificationConnector(
      { verifyAccount } as unknown as LeanClient,
      connectorSettingsService,
    );
  });

  it('identifies itself as the synchronous bank verification adapter', () => {
    expect(connector.id).toBe(LEAN_IBAN_VERIFICATION_CONNECTOR_ID);
    expect(connector.type).toBe('bank_verification');
    expect(connector.settingsSchema?.fields.map(({ key }) => key)).toEqual([
      'clientId',
      'clientSecret',
    ]);
  });

  describe('validateDeclaration', () => {
    const declaration = (fieldMapping: Record<string, string>) =>
      ({ name: 'verify_iban', fieldMapping }) as unknown as NormalizedWorkflowConnectorFallback;

    it('accepts a field mapping carrying iban and nationalId', () => {
      expect(() =>
        connector.validateDeclaration(declaration({ iban: 'iban', nationalId: 'nationalId' })),
      ).not.toThrow();
    });

    it.each(['iban', 'nationalId'])('refuses a field mapping without %s', (missing) => {
      const fieldMapping: Record<string, string> = { iban: 'iban', nationalId: 'nationalId' };
      delete fieldMapping[missing];

      expect(() => connector.validateDeclaration(declaration(fieldMapping))).toThrow(
        `fieldMapping must map "${missing}"`,
      );
    });
  });

  describe('execute', () => {
    it('accepts a verified owner of an active account and sends the resolved credentials', async () => {
      verifyAccount.mockResolvedValue({ kind: 'ok', body: verification() });

      const result = await connector.execute(createInput());

      expect(result.isAccepted()).toBe(true);
      expect(verifyAccount).toHaveBeenCalledWith(
        { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
        { iban: IBAN, nationalId: NATIONAL_ID },
      );
      expect(connectorSettingsService.resolve).toHaveBeenCalledWith(connector);
    });

    it('rejects an IBAN the national ID does not own, as CONNECTOR_REJECTED with the Lean reason', async () => {
      verifyAccount.mockResolvedValue({
        kind: 'ok',
        body: withVerifications({
          account_ownership_verified: false,
          account_status: null,
          matching: { type: 'NO_MATCH', score: 0 },
        }),
      });

      const result = await connector.execute(createInput());

      expect(result.isRejected()).toBe(true);
      expect(result.reason).toBe('CONNECTOR_REJECTED');
      expect(result.metadata).toEqual({ leanReason: LEAN_REJECTION_IBAN_OWNERSHIP_NOT_VERIFIED });
    });

    it('maps ownership false to not verified whatever the account status says', async () => {
      verifyAccount.mockResolvedValue({
        kind: 'ok',
        body: withVerifications({ account_ownership_verified: false, account_status: 'ACTIVE' }),
      });

      const result = await connector.execute(createInput());

      expect(result.metadata).toEqual({ leanReason: LEAN_REJECTION_IBAN_OWNERSHIP_NOT_VERIFIED });
    });

    it('rejects a verified owner whose account is not active as not verifiable', async () => {
      verifyAccount.mockResolvedValue({
        kind: 'ok',
        body: withVerifications({ account_status: 'CLOSED' }),
      });

      const result = await connector.execute(createInput());

      expect(result.isRejected()).toBe(true);
      expect(result.reason).toBe('CONNECTOR_REJECTED');
      expect(result.metadata).toEqual({ leanReason: LEAN_REJECTION_IBAN_NOT_VERIFIABLE });
    });

    it('rejects a verification Lean could not complete as not verifiable', async () => {
      verifyAccount.mockResolvedValue({
        kind: 'ok',
        body: verification({ status: 'GIVEN_INPUT_CANNOT_BE_VERIFIED', verifications: null }),
      });

      const result = await connector.execute(createInput());

      expect(result.isRejected()).toBe(true);
      expect(result.reason).toBe('CONNECTOR_REJECTED');
      expect(result.metadata).toEqual({ leanReason: LEAN_REJECTION_IBAN_NOT_VERIFIABLE });
    });

    it('turns INVALID_PARAMETERS into retryable invalid data on the iban field by default', async () => {
      verifyAccount.mockResolvedValue({
        kind: 'error',
        httpStatus: 400,
        body: {
          status: LEAN_ERROR_STATUS_INVALID_PARAMETERS,
          message: 'Account details validation failed. Invalid IBAN',
        },
      });

      const result = await connector.execute(
        createInput({ payloadFieldSources: { iban: 'bankIban', nationalId: 'nationalId' } }),
      );

      expect(result.isInvalidData()).toBe(true);
      expect(result.errors).toEqual({ bankIban: ['LEAN_INVALID_PARAMETERS'] });
      expect(result.metadata).toEqual({
        [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
      });
    });

    it('puts INVALID_PARAMETERS on the national ID when Lean names it', async () => {
      verifyAccount.mockResolvedValue({
        kind: 'error',
        httpStatus: 400,
        body: {
          status: LEAN_ERROR_STATUS_INVALID_PARAMETERS,
          message: 'Identifications validation failed. Invalid national ID',
        },
      });

      const result = await connector.execute(createInput());

      expect(result.isInvalidData()).toBe(true);
      expect(result.errors).toEqual({ nationalId: ['LEAN_INVALID_PARAMETERS'] });
    });

    it('returns invalid when the payload lacks the IBAN or national ID, without calling Lean', async () => {
      const result = await connector.execute(createInput({ payload: { iban: IBAN } }));

      expect(result.isInvalid()).toBe(true);
      expect(verifyAccount).not.toHaveBeenCalled();
    });

    it('throws LeanUnavailableException when the client reports Lean unavailable', async () => {
      verifyAccount.mockRejectedValue(new LeanUnavailableException());

      await expect(connector.execute(createInput())).rejects.toBeInstanceOf(
        LeanUnavailableException,
      );
    });

    it('treats a 4xx that is not INVALID_PARAMETERS as an integration failure', async () => {
      verifyAccount.mockResolvedValue({
        kind: 'error',
        httpStatus: 404,
        body: { status: LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER, message: '' },
      });

      await expect(connector.execute(createInput())).rejects.toBeInstanceOf(
        LeanUnavailableException,
      );
    });

    it('never logs the IBAN, the national ID or the credentials', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      verifyAccount.mockResolvedValueOnce({
        kind: 'ok',
        body: withVerifications({ account_ownership_verified: false }),
      });
      verifyAccount.mockResolvedValueOnce({
        kind: 'error',
        httpStatus: 403,
        body: { status: 'FORBIDDEN', message: '' },
      });

      await connector.execute(createInput());
      await expect(connector.execute(createInput())).rejects.toBeInstanceOf(
        LeanUnavailableException,
      );

      const logged = JSON.stringify([...logSpy.mock.calls, ...warnSpy.mock.calls]);

      for (const secret of [IBAN, NATIONAL_ID, CLIENT_ID, CLIENT_SECRET]) {
        expect(logged).not.toContain(secret);
      }
    });
  });
});
