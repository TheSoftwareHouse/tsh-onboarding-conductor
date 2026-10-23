import type { ConnectorExecutionInput } from '../../../ports/connector-adapter.port';
import { CreditBankDataInvalidError } from './credit-provider.port';
import { buildCreditSubmission, CreditNoAccountsSelectedError } from './credit-submission';

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';
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

const build = (input: ConnectorExecutionInput, deps: ReturnType<typeof createDeps>) =>
  buildCreditSubmission('fake_credit', input, 2, deps.resolver as never, deps.storage as never);

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

  describe('with an account selection', () => {
    const TWO_ACCOUNTS = JSON.stringify({
      accounts: [{ name: 'first' }, { name: 'second' }, { name: 'third' }],
      extra: true,
    });
    const selectedInput = (selection: unknown): ConnectorExecutionInput => ({
      ...createInput({ bankData: 'doc-1', accountSelection: selection }),
      payloadFieldSources: { bankData: 'bank_data_document', accountSelection: 'selectedAccounts' },
    });

    it('keeps the selected positions in document order and ignores positions past the end', async () => {
      const deps = createDeps();
      deps.storage.readObject.mockResolvedValue(Buffer.from(TWO_ACCOUNTS));

      const submission = await build(
        selectedInput(['account-03', 'account-01', 'account-09']),
        deps,
      );

      expect(JSON.parse(submission!.bankData.document.toString())).toEqual({
        accounts: [{ name: 'first' }, { name: 'third' }],
        extra: true,
      });
    });

    it('submits the whole document when the payload carries no selection', async () => {
      const deps = createDeps();
      deps.storage.readObject.mockResolvedValue(Buffer.from(TWO_ACCOUNTS));

      const submission = await build(createInput({ bankData: 'doc-1' }), deps);

      expect(submission!.bankData.document.toString()).toBe(TWO_ACCOUNTS);
    });

    it('refuses a selection that keeps nothing, naming the selection field', async () => {
      const deps = createDeps();
      deps.storage.readObject.mockResolvedValue(Buffer.from(TWO_ACCOUNTS));

      await expect(build(selectedInput(['account-07', 'nonsense']), deps)).rejects.toMatchObject({
        name: 'CreditNoAccountsSelectedError',
        sourceField: 'selectedAccounts',
      });
      await expect(build(selectedInput([]), deps)).rejects.toBeInstanceOf(
        CreditNoAccountsSelectedError,
      );
    });

    it.each([
      ['not JSON', 'not json'],
      ['an array', '[]'],
      ['no accounts array', '{"accounts":{}}'],
    ])('rejects a document that is %s as invalid bank data', async (_label, content) => {
      const deps = createDeps();
      deps.storage.readObject.mockResolvedValue(Buffer.from(content));

      await expect(build(selectedInput(['account-01']), deps)).rejects.toBeInstanceOf(
        CreditBankDataInvalidError,
      );
    });
  });

  it('accepts a JSON content type with parameters', async () => {
    const submission = await build(
      createInput({ bankData: 'doc-1' }),
      createDeps('application/json; charset=utf-8'),
    );

    expect(submission).toBeDefined();
  });
});
