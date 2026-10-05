import { KycConfigInvalidError, parseKycConfig } from './kyc-config';

const CONNECTOR_ID = 'test_kyc';

const VALID_DOCUMENT = {
  payloadField: 'idFrontDocumentId',
  idDocSetType: 'IDENTITY',
  idDocType: 'ID_CARD',
  idDocSubType: 'FRONT_SIDE',
  country: 'PL',
};

const VALID_CONFIG: Readonly<Record<string, unknown>> = {
  sourceKey: 'source',
  documents: [VALID_DOCUMENT],
  questionnairePathMap: { purposeOfAccount: 'purpose.accountPurpose' },
  maxAttemptsPerDocSet: 3,
};

const parse = (config: Readonly<Record<string, unknown>>) => parseKycConfig(CONNECTOR_ID, config);

describe('parseKycConfig', () => {
  it('parses a valid config and leaves every other key to the provider', () => {
    const parsed = parse({ ...VALID_CONFIG, levelName: 'level-1', anything: { nested: true } });

    expect(parsed).toEqual({
      sourceKey: 'source',
      documents: [
        {
          payloadField: 'idFrontDocumentId',
          idDocSetType: 'IDENTITY',
          idDocType: 'ID_CARD',
          idDocSubType: 'FRONT_SIDE',
          country: 'PL',
          countryField: undefined,
          optional: false,
        },
      ],
      questionnairePathMap: { purposeOfAccount: 'purpose.accountPurpose' },
      maxAttemptsPerDocSet: 3,
      providerConfig: { levelName: 'level-1', anything: { nested: true } },
    });
  });

  it('names the connector and the key in its error message', () => {
    const config: Record<string, unknown> = { ...VALID_CONFIG };
    delete config.sourceKey;

    expect(() => parse(config)).toThrow(KycConfigInvalidError);
    expect(() => parse(config)).toThrow(
      'Invalid test_kyc connector config key "sourceKey": must be a non-empty string',
    );
  });

  it('refuses a blank sourceKey', () => {
    expect(() => parse({ ...VALID_CONFIG, sourceKey: '   ' })).toThrow(/sourceKey/);
  });

  it.each([
    ['absent', undefined],
    ['zero', 0],
    ['negative', -1],
    ['non-integer', 1.5],
  ])('refuses maxAttemptsPerDocSet when %s', (_label, value) => {
    expect(() => parse({ ...VALID_CONFIG, maxAttemptsPerDocSet: value })).toThrow(
      /maxAttemptsPerDocSet/,
    );
  });

  describe('questionnairePathMap', () => {
    it.each([
      ['absent', undefined],
      ['empty', {}],
    ])('is undefined when %s', (_label, value) => {
      expect(parse({ ...VALID_CONFIG, questionnairePathMap: value }).questionnairePathMap).toBe(
        undefined,
      );
    });

    it('refuses a path without a "." separator', () => {
      expect(() => parse({ ...VALID_CONFIG, questionnairePathMap: { item: 'purpose' } })).toThrow(
        /questionnairePathMap\.item/,
      );
    });

    it('refuses a value that is not an object', () => {
      expect(() => parse({ ...VALID_CONFIG, questionnairePathMap: ['a.b'] })).toThrow(
        /questionnairePathMap/,
      );
    });
  });

  describe('documents', () => {
    it('refuses an empty list', () => {
      expect(() => parse({ ...VALID_CONFIG, documents: [] })).toThrow(/documents/);
    });

    it.each(['payloadField', 'idDocSetType', 'idDocType', 'country'])(
      'refuses an entry missing %s',
      (missingKey) => {
        const incomplete: Record<string, unknown> = { ...VALID_DOCUMENT };
        delete incomplete[missingKey];

        expect(() => parse({ ...VALID_CONFIG, documents: [incomplete] })).toThrow(
          KycConfigInvalidError,
        );
      },
    );

    it('accepts countryField in place of a fixed country', () => {
      const document: Record<string, unknown> = { ...VALID_DOCUMENT };
      delete document.country;

      expect(
        parse({
          ...VALID_CONFIG,
          documents: [{ ...document, countryField: 'documentIssuingCountry' }],
        }).documents[0],
      ).toMatchObject({ countryField: 'documentIssuingCountry', country: undefined });
    });

    it('refuses an entry declaring both country and countryField', () => {
      expect(() =>
        parse({
          ...VALID_CONFIG,
          documents: [{ ...VALID_DOCUMENT, countryField: 'documentIssuingCountry' }],
        }),
      ).toThrow(/exactly one of country and countryField/);
    });

    it('refuses an entry declaring neither', () => {
      const document: Record<string, unknown> = { ...VALID_DOCUMENT };
      delete document.country;

      expect(() => parse({ ...VALID_CONFIG, documents: [document] })).toThrow(
        /exactly one of country and countryField/,
      );
    });

    it.each([
      ['alpha-2', 'PL'],
      ['lower-case alpha-2', 'pl'],
      ['alpha-3', 'POL'],
      ['padded alpha-3', ' pol '],
    ])('normalises a fixed %s country to alpha-2', (_label, country) => {
      expect(
        parse({ ...VALID_CONFIG, documents: [{ ...VALID_DOCUMENT, country }] }).documents[0]
          ?.country,
      ).toBe('PL');
    });

    it.each(['P', 'POLA', 'XX', 'XXX', '12'])('refuses the fixed country %j', (country) => {
      expect(() => parse({ ...VALID_CONFIG, documents: [{ ...VALID_DOCUMENT, country }] })).toThrow(
        /documents\[0\]\.country/,
      );
    });

    it('refuses a non-boolean optional flag', () => {
      expect(() =>
        parse({ ...VALID_CONFIG, documents: [{ ...VALID_DOCUMENT, optional: 'yes' }] }),
      ).toThrow(/optional/);
    });

    it('accepts idDocSubType absent and two entries sharing a docSet', () => {
      const selfie: Record<string, unknown> = { ...VALID_DOCUMENT, payloadField: 'selfie' };
      delete selfie.idDocSubType;

      const parsed = parse({
        ...VALID_CONFIG,
        documents: [VALID_DOCUMENT, selfie, VALID_DOCUMENT],
      });

      expect(parsed.documents[1]?.idDocSubType).toBeUndefined();
      expect(parsed.documents.map((document) => document.idDocSetType)).toEqual([
        'IDENTITY',
        'IDENTITY',
        'IDENTITY',
      ]);
    });
  });
});
