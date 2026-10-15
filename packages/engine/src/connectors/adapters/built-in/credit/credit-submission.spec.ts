import type { ConnectorExecutionInput } from '../../../ports/connector-adapter.port';
import { parseCreditConfig } from './credit-config';
import { CreditBankDataInvalidError } from './credit-provider.port';
import { buildCreditSubmission } from './credit-submission';

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';
const CONFIG = parseCreditConfig('fake_credit', {
  bands: { approveFrom: 600, reviewFrom: 500 },
  maxAttempts: 2,
});

const createInput = (payload: Record<string, unknown>): ConnectorExecutionInput => ({
  declaration: { order: 1, config: {} },
  execution: { onboardingId: ONBOARDING_ID, stepName: 'credit' },
  context: {},
  payload,
  payloadFieldSources: { bankData: 'bank_data_document' },
});

const createDeps = (contentType = 'application/json') => ({
  resolver: {
    resolve: jest.fn().mockResolvedValue({
      finalObjectKey: 'key',
      verifiedEtag: '"e"',
      verifiedSizeBytes: 4,
      contentType,
    }),
  },
  storage: { readObject: jest.fn().mockResolvedValue(Buffer.from('{}')) },
});

const build = (
  input: ConnectorExecutionInput,
  deps: ReturnType<typeof createDeps>,
  config = CONFIG,
) =>
  buildCreditSubmission(
    'fake_credit',
    config,
    input,
    2,
    deps.resolver as never,
    deps.storage as never,
  );

describe('buildCreditSubmission', () => {
  it('reads the document through its mapped source field and carries the attempt and applicant', async () => {
    const deps = createDeps();

    const submission = await build(
      createInput({ bankData: 'doc-1', firstName: ' Sherlock ', email: 'a@b.c' }),
      deps,
    );

    expect(deps.resolver.resolve).toHaveBeenCalledWith({
      documentId: 'doc-1',
      onboardingId: ONBOARDING_ID,
      sourceField: 'bank_data_document',
    });
    expect(submission).toEqual({
      onboardingId: ONBOARDING_ID,
      attempt: 2,
      applicant: { firstName: 'Sherlock', email: 'a@b.c' },
      bankData: { format: 'json', document: Buffer.from('{}'), contentType: 'application/json' },
    });
  });

  it('renames an applicant role through config.applicant', async () => {
    const config = parseCreditConfig('fake_credit', {
      bands: { approveFrom: 600, reviewFrom: 500 },
      maxAttempts: 2,
      applicant: { lastName: 'surname' },
    });

    const submission = await build(
      createInput({ bankData: 'doc-1', surname: 'Holmes' }),
      createDeps(),
      config,
    );

    expect(submission?.applicant).toEqual({ lastName: 'Holmes' });
  });

  it('leaves the applicant absent when no role was answered', async () => {
    const submission = await build(createInput({ bankData: 'doc-1' }), createDeps());

    expect(submission?.applicant).toBeUndefined();
  });

  it('answers undefined without a document reference or a completed document', async () => {
    const deps = createDeps();

    expect(await build(createInput({}), deps)).toBeUndefined();

    deps.resolver.resolve.mockResolvedValueOnce(undefined);
    expect(await build(createInput({ bankData: 'doc-1' }), deps)).toBeUndefined();
  });

  it('rejects a document that is not JSON', async () => {
    await expect(
      build(createInput({ bankData: 'doc-1' }), createDeps('application/pdf')),
    ).rejects.toBeInstanceOf(CreditBankDataInvalidError);
  });

  it('accepts a JSON content type with parameters', async () => {
    const submission = await build(
      createInput({ bankData: 'doc-1' }),
      createDeps('application/json; charset=utf-8'),
    );

    expect(submission).toBeDefined();
  });
});
