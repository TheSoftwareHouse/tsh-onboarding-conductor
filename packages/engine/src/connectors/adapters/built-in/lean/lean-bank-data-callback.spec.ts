import {
  buildLeanInsightsStartDate,
  isLeanDataUsable,
  mapLeanInsights,
  parseLeanCallback,
  parseLeanSignatureHeader,
} from './lean-bank-data-callback';
import {
  LEAN_EVENT_ENTITY_CREATED,
  LEAN_EVENT_ENTITY_DATA_REFRESH_UPDATED,
  LEAN_EVENT_ENTITY_UPDATED,
  type LeanEmployment,
  type LeanIncome,
} from './lean-contract';

const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const MIN_MONTHLY_SALARY = 4000;
const ONBOARDING_ID = '33333333-3333-4333-8333-333333333333';

const encode = (body: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(body));

const refreshEvent = (status: string, dataStatus?: unknown) =>
  encode({
    type: LEAN_EVENT_ENTITY_DATA_REFRESH_UPDATED,
    payload: {
      refresh_id: 'refresh-1',
      entity_id: ENTITY_ID,
      customer_id: CUSTOMER_ID,
      status,
      data_status: dataStatus,
    },
  });

const category = (average: number, counts: readonly number[]) => ({
  currency: 'SAR',
  total: { amount: average * counts.length, count: counts.length, average_monthly_amount: average },
  monthly_totals: counts.map((count, index) => ({
    month: index + 1,
    year: 2026,
    amount: average,
    count,
  })),
});

const income = (insights: LeanIncome['insights']): LeanIncome => ({
  status: 'OK',
  results_id: 'results-1',
  insights,
});

const employment = (details: LeanEmployment['insights']['employment_details']): LeanEmployment => ({
  status: 'OK',
  results_id: 'results-2',
  insights: { employment_details: details },
});

describe('parseLeanCallback', () => {
  it.each([LEAN_EVENT_ENTITY_CREATED, LEAN_EVENT_ENTITY_UPDATED])(
    'reads %s as an entity event carrying app_user_id',
    (type) => {
      const body = encode({
        type,
        payload: { id: ENTITY_ID, app_user_id: ONBOARDING_ID, customer_id: CUSTOMER_ID },
      });

      expect(parseLeanCallback(body)).toEqual({
        kind: 'entity',
        customerId: CUSTOMER_ID,
        appUserId: ONBOARDING_ID,
      });
    },
  );

  it('reads a pending refresh without treating it as finished', () => {
    expect(parseLeanCallback(refreshEvent('PENDING'))).toMatchObject({
      kind: 'refresh',
      customerId: CUSTOMER_ID,
      entityId: ENTITY_ID,
      finished: false,
    });
  });

  it('reads a finished refresh with its per-type data statuses', () => {
    const event = parseLeanCallback(
      refreshEvent('FINISHED', {
        accounts: 'SUCCESS',
        identity: 'UNSUPPORTED',
        account_data: [{ transactions: 'PARTIAL', balances: 'SUCCESS' }],
      }),
    );

    expect(event).toEqual({
      kind: 'refresh',
      customerId: CUSTOMER_ID,
      entityId: ENTITY_ID,
      finished: true,
      dataStatus: { accounts: 'SUCCESS', account_data: [{ transactions: 'PARTIAL' }] },
    });
  });

  it.each([
    ['an unrelated event type', encode({ type: 'bank.availability.updated', payload: {} })],
    ['a refresh with an unknown status', refreshEvent('RUNNING')],
    ['a body that is not JSON', new TextEncoder().encode('not json')],
    ['a body with no payload', encode({ type: LEAN_EVENT_ENTITY_CREATED })],
    [
      'an entity event without app_user_id',
      encode({ type: LEAN_EVENT_ENTITY_CREATED, payload: { customer_id: CUSTOMER_ID } }),
    ],
  ])('returns undefined for %s', (_label, body) => {
    expect(parseLeanCallback(body)).toBeUndefined();
  });
});

describe('isLeanDataUsable', () => {
  it.each(['SUCCESS', 'OK', 'PARTIAL'])('accepts %s transactions', (transactions) => {
    expect(isLeanDataUsable({ accounts: 'SUCCESS', account_data: [{ transactions }] })).toBe(true);
  });

  it.each([
    ['failed transactions', { accounts: 'SUCCESS', account_data: [{ transactions: 'FAILED' }] }],
    [
      'unsupported transactions',
      { accounts: 'SUCCESS', account_data: [{ transactions: 'UNSUPPORTED' }] },
    ],
    [
      'one bad account among good ones',
      {
        accounts: 'SUCCESS',
        account_data: [{ transactions: 'SUCCESS' }, { transactions: 'FAILED' }],
      },
    ],
    ['failed accounts', { accounts: 'FAILED', account_data: [{ transactions: 'SUCCESS' }] }],
    ['no data status at all', undefined],
  ])('refuses %s', (_label, dataStatus) => {
    expect(isLeanDataUsable(dataStatus)).toBe(false);
  });
});

describe('buildLeanInsightsStartDate', () => {
  it('goes back six months in UTC', () => {
    expect(buildLeanInsightsStartDate(new Date('2026-10-13T23:30:00Z'))).toBe('2026-04-13');
  });
});

describe('parseLeanSignatureHeader', () => {
  it.each(['sha512=abc123', 'SHA512=abc123', ' sha512=abc123 '])(
    'strips the algorithm prefix from %p',
    (header) => {
      expect(parseLeanSignatureHeader(header)).toEqual(['abc123']);
    },
  );

  it('leaves a bare digest alone', () => {
    expect(parseLeanSignatureHeader('abc123')).toEqual(['abc123']);
  });
});

describe('mapLeanInsights', () => {
  it('maps salary, non-salary and the consistent employer to callback fields', () => {
    const fields = mapLeanInsights(
      income({ salary: category(6000, [2, 1, 0, 1]), non_salary: category(350, [3, 0]) }),
      employment([
        {
          bank_employer_name: 'OTHER LLC',
          matched_reference_employer: null,
          salary_consistent: false,
        },
        {
          bank_employer_name: 'ACME KSA',
          matched_reference_employer: { name: { en: 'Acme Arabia', ar: 'أكمي' }, cr_number: 1 },
          salary_consistent: true,
        },
      ]),
      MIN_MONTHLY_SALARY,
    );

    expect(fields).toEqual({
      bankConnectOutcome: 'connected',
      salaryMonthlyAverage: 6000,
      salaryMonthsDetected: 3,
      nonSalaryMonthlyAverage: 350,
      salaryConsistent: true,
      salaryThresholdMet: true,
      employerName: 'Acme Arabia',
    });
  });

  it('falls back to the bank employer name when no reference employer matched', () => {
    const fields = mapLeanInsights(
      income({ salary: category(5000, [1]) }),
      employment([
        {
          bank_employer_name: 'ACME KSA',
          matched_reference_employer: null,
          salary_consistent: true,
        },
      ]),
      MIN_MONTHLY_SALARY,
    );

    expect(fields.employerName).toBe('ACME KSA');
  });

  it('reports zero salary, no consistency and no employer when there is none', () => {
    const fields = mapLeanInsights(income({}), employment([]), MIN_MONTHLY_SALARY);

    expect(fields).toEqual({
      bankConnectOutcome: 'connected',
      salaryMonthlyAverage: 0,
      salaryMonthsDetected: 0,
      nonSalaryMonthlyAverage: 0,
      salaryConsistent: false,
      salaryThresholdMet: false,
    });
    expect(fields).not.toHaveProperty('employerName');
  });

  it.each([
    ['above', 5999, true],
    ['at', 6000, true],
    ['below', 6001, false],
  ])(
    'sets salaryThresholdMet for an average of 6000 %s the threshold',
    (_label, threshold, met) => {
      const fields = mapLeanInsights(
        income({ salary: category(6000, [1]) }),
        employment([]),
        threshold,
      );

      expect(fields.salaryThresholdMet).toBe(met);
    },
  );
});
