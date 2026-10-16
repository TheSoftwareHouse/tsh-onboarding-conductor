import { CreditConfigInvalidError, parseCreditConfig } from './credit-config';

const CONNECTOR_ID = 'test_credit';

const VALID_CONFIG: Readonly<Record<string, unknown>> = {
  bands: { approveFrom: 700, reviewFrom: 400 },
  maxAttempts: 3,
};

const parse = (config: Readonly<Record<string, unknown>>) =>
  parseCreditConfig(CONNECTOR_ID, config);

describe('parseCreditConfig', () => {
  it('parses a minimal config, applying the documented defaults', () => {
    expect(parse(VALID_CONFIG)).toEqual({
      bands: { approveFrom: 700, reviewFrom: 400 },
      maxAttempts: 3,
      products: ['creditScore', 'paymentScore'],
      report: 'full',
      providerConfig: {},
    });
  });

  it('parses every kernel key and leaves every other key to the provider', () => {
    const parsed = parse({
      ...VALID_CONFIG,
      products: ['creditScore'],
      report: 'summary',
      region: 'uk',
    });

    expect(parsed.products).toEqual(['creditScore']);
    expect(parsed.report).toBe('summary');
    expect(parsed.providerConfig).toEqual({ region: 'uk' });
  });

  it("consumes exactly the four keys the step type compiles; a step-level key is the provider's", () => {
    const parsed = parse({
      ...VALID_CONFIG,
      applicant: { firstName: true },
      bankDataMaxSizeBytes: 1,
    });

    expect(parsed).not.toHaveProperty('applicant');
    expect(parsed).not.toHaveProperty('bankDataMaxSizeBytes');
    expect(parsed.providerConfig).toEqual({
      applicant: { firstName: true },
      bankDataMaxSizeBytes: 1,
    });
  });

  it.each([
    ['bands missing', { maxAttempts: 3 }, 'bands'],
    [
      'bands.approveFrom not a number',
      { ...VALID_CONFIG, bands: { approveFrom: '7', reviewFrom: 4 } },
      'bands.approveFrom',
    ],
    [
      'bands equal',
      { ...VALID_CONFIG, bands: { approveFrom: 400, reviewFrom: 400 } },
      'bands.approveFrom',
    ],
    [
      'bands inverted',
      { ...VALID_CONFIG, bands: { approveFrom: 300, reviewFrom: 400 } },
      'bands.approveFrom',
    ],
    ['maxAttempts missing', { bands: VALID_CONFIG.bands }, 'maxAttempts'],
    ['maxAttempts zero', { ...VALID_CONFIG, maxAttempts: 0 }, 'maxAttempts'],
    ['empty products', { ...VALID_CONFIG, products: [] }, 'products'],
    ['unknown report mode', { ...VALID_CONFIG, report: 'huge' }, 'report'],
  ])('rejects %s naming the key', (_label, config, key) => {
    expect(() => parse(config)).toThrow(CreditConfigInvalidError);
    expect(() => parse(config)).toThrow(`"${key}"`);
  });
});
