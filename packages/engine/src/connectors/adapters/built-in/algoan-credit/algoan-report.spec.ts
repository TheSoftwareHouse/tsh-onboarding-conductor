import { parseCreditConfig } from '../credit/credit-config';
import type { AlgoanClient } from './algoan-client';
import { buildAlgoanReport, stripNestedTransactions } from './algoan-report';

const CREDENTIALS = { clientId: 'client-1', clientSecret: 'secret-1' };
const SOURCE = {
  customerId: 'c-1',
  analysisId: 'a-1',
  metadata: { creditInsights: { days: 99 } },
  scores: { creditScore: { value: 965 } },
};

const config = (overrides: Record<string, unknown> = {}) =>
  parseCreditConfig('algoan_credit', {
    bands: { approveFrom: 700, reviewFrom: 400 },
    maxAttempts: 2,
    products: ['creditScore', 'insights'],
    ...overrides,
  });

const padding = (size: number) => 'x'.repeat(size);

const createClient = (transactionsSize = 10, cashFlowsSize = 10) =>
  ({
    getEssentials: jest.fn().mockResolvedValue({ historicalDepth: 99 }),
    getCreditInsights: jest.fn(async (_c, _cu, _a, kind: string) =>
      kind === 'cash-flows'
        ? [{ id: 'flow', pad: padding(cashFlowsSize), transactions: [{ id: 't' }] }]
        : { totalAmount: 1, transactions: [{ id: 't' }], categories: [{ transactions: [1] }] },
    ),
    listAccounts: jest.fn().mockResolvedValue({ resources: [{ id: 'acc-1' }] }),
    listTransactions: jest
      .fn()
      .mockResolvedValue({ resources: [{ pad: padding(transactionsSize) }] }),
  }) as unknown as jest.Mocked<AlgoanClient>;

const build = (client: AlgoanClient, cfg = config(), maxBytes?: number) =>
  buildAlgoanReport(client, CREDENTIALS, SOURCE, cfg, maxBytes);

describe('stripNestedTransactions', () => {
  it('removes transactions arrays at any depth and keeps the rest', () => {
    expect(
      stripNestedTransactions({ a: 1, transactions: [1], b: [{ transactions: [2], c: 3 }] }),
    ).toEqual({ a: 1, b: [{ c: 3 }] });
  });
});

describe('buildAlgoanReport', () => {
  it('composes scores, metadata, insights without transactions, accounts, essentials, page 1', async () => {
    const report = await build(createClient());

    expect(Object.keys(report ?? {})).toEqual([
      'scores',
      'metadata',
      'creditInsights',
      'accounts',
      'essentials',
      'transactions',
    ]);
    expect(report?.creditInsights).toEqual({
      incomes: { totalAmount: 1, categories: [{}] },
      expenses: { totalAmount: 1, categories: [{}] },
      loans: { totalAmount: 1, categories: [{}] },
      risks: { totalAmount: 1, categories: [{}] },
      cashFlows: [{ id: 'flow', pad: 'xxxxxxxxxx' }],
    });
    expect(report?.accounts).toEqual([{ id: 'acc-1' }]);
  });

  it('masks account identifiers in the stored report', async () => {
    const client = createClient();
    client.listAccounts.mockResolvedValue({
      resources: [{ id: 'acc-1', iban: 'GB29NWBK60161331926819' }],
    } as never);

    expect((await build(client))?.accounts).toEqual([{ id: 'acc-1', iban: '****6819' }]);
  });

  it('makes no call for report none', async () => {
    const client = createClient();

    await expect(build(client, config({ report: 'none' }))).resolves.toBeUndefined();
    expect(client.getEssentials).not.toHaveBeenCalled();
    expect(client.listTransactions).not.toHaveBeenCalled();
  });

  it('adds essentials only for report summary', async () => {
    const client = createClient();

    await expect(build(client, config({ report: 'summary' }))).resolves.toEqual({
      scores: SOURCE.scores,
      metadata: SOURCE.metadata,
      essentials: { historicalDepth: 99 },
    });
    expect(client.getCreditInsights).not.toHaveBeenCalled();
    expect(client.listTransactions).not.toHaveBeenCalled();
  });

  it('skips the insight endpoints when the step did not ask for insights', async () => {
    const client = createClient();
    const report = await build(client, config({ products: ['creditScore'] }));

    expect(client.getCreditInsights).not.toHaveBeenCalled();
    expect(report).not.toHaveProperty('creditInsights');
  });

  describe('trimming to the cap', () => {
    const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

    it('keeps everything under the cap', async () => {
      const report = await build(createClient(1000, 1000));

      expect(report).toHaveProperty('transactions');
      expect(report?.creditInsights).toHaveProperty('cashFlows');
    });

    it('drops transactions first', async () => {
      const full = await build(createClient(5000, 10));
      const cap = size(full) - 1;
      const report = await build(createClient(5000, 10), config(), cap);

      expect(report).not.toHaveProperty('transactions');
      expect(report?.creditInsights).toHaveProperty('cashFlows');
    });

    it('drops cashFlows only when transactions alone were not enough', async () => {
      const client = () => createClient(10, 5000);
      const withoutTransactions = size({ ...(await build(client())), transactions: undefined });
      const report = await build(client(), config(), withoutTransactions - 1);

      expect(report).not.toHaveProperty('transactions');
      expect(report?.creditInsights).not.toHaveProperty('cashFlows');
      expect(report?.creditInsights).toHaveProperty('incomes');
    });

    it('replaces a report that still does not fit with a marker', async () => {
      await expect(build(createClient(), config(), 10)).resolves.toMatchObject({ truncated: true });
    });
  });
});
