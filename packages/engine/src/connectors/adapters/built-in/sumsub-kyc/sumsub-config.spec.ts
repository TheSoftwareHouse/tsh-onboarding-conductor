import { KycConfigInvalidError } from '../kyc/kyc-config';
import {
  parseSumsubConfig,
  parseSumsubProviderConfig,
  SumsubConfigInvalidError,
  type SumsubConfig,
} from './sumsub-config';

const VALID_DOCUMENT = {
  payloadField: 'idFrontDocumentId',
  idDocSetType: 'IDENTITY',
  idDocType: 'ID_CARD',
  idDocSubType: 'FRONT_SIDE',
  country: 'POL',
};

const VALID_SECOND_DOCUMENT = {
  payloadField: 'idBackDocumentId',
  idDocSetType: 'IDENTITY',
  idDocType: 'ID_CARD',
  idDocSubType: 'BACK_SIDE',
  country: 'POL',
};

const VALID_CONFIG: Readonly<Record<string, unknown>> = {
  levelName: 'individual-standard-v2',
  sourceKey: 'sumsub',
  questionnaireDefinitionId: 'onboardingQuestionnaire',
  documents: [VALID_DOCUMENT],
  questionnairePathMap: {
    purposeOfAccount: 'purpose.accountPurpose',
  },
  maxAttemptsPerDocSet: 3,
};

describe('parseSumsubConfig', () => {
  it('parses a valid config to its typed shape', () => {
    const parsed = parseSumsubConfig(VALID_CONFIG);

    const expected: SumsubConfig = {
      levelName: 'individual-standard-v2',
      sourceKey: 'sumsub',
      questionnaireDefinitionId: 'onboardingQuestionnaire',
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
      questionnairePathMap: {
        purposeOfAccount: 'purpose.accountPurpose',
      },
      maxAttemptsPerDocSet: 3,
    };

    expect(parsed).toEqual(expected);
  });

  it('refuses a missing level name', () => {
    const config: Record<string, unknown> = { ...VALID_CONFIG };
    delete config.levelName;

    expect(() => parseSumsubConfig(config)).toThrow(KycConfigInvalidError);
    expect(() => parseSumsubConfig(config)).toThrow(/levelName/);
  });

  it('refuses a missing questionnaire definition id', () => {
    const config: Record<string, unknown> = { ...VALID_CONFIG };
    delete config.questionnaireDefinitionId;

    expect(() => parseSumsubConfig(config)).toThrow(SumsubConfigInvalidError);
    expect(() => parseSumsubConfig(config)).toThrow(/questionnaireDefinitionId/);
  });

  it.each([
    ['absent', undefined],
    ['empty', {}],
  ])(
    'requires a questionnairePathMap — Sumsub cannot finalise without one (%s)',
    (_label, value) => {
      expect(() => parseSumsubConfig({ ...VALID_CONFIG, questionnairePathMap: value })).toThrow(
        KycConfigInvalidError,
      );
      expect(() => parseSumsubConfig({ ...VALID_CONFIG, questionnairePathMap: value })).toThrow(
        /questionnairePathMap/,
      );
    },
  );

  it('refuses an empty document list', () => {
    const config = { ...VALID_CONFIG, documents: [] };

    expect(() => parseSumsubConfig(config)).toThrow(KycConfigInvalidError);
    expect(() => parseSumsubConfig(config)).toThrow(/documents/);
  });

  it('refuses a questionnaire path without a "." separator', () => {
    const config = { ...VALID_CONFIG, questionnairePathMap: { purposeOfAccount: 'purpose' } };

    expect(() => parseSumsubConfig(config)).toThrow(KycConfigInvalidError);
    expect(() => parseSumsubConfig(config)).toThrow(/questionnairePathMap\.purposeOfAccount/);
  });

  it('refuses a missing sourceKey', () => {
    const config: Record<string, unknown> = { ...VALID_CONFIG };
    delete config.sourceKey;

    expect(() => parseSumsubConfig(config)).toThrow(KycConfigInvalidError);
    expect(() => parseSumsubConfig(config)).toThrow(/sourceKey/);
  });

  it('refuses a blank sourceKey', () => {
    const config = { ...VALID_CONFIG, sourceKey: '   ' };

    expect(() => parseSumsubConfig(config)).toThrow(KycConfigInvalidError);
    expect(() => parseSumsubConfig(config)).toThrow(/sourceKey/);
  });

  it.each([
    ['absent', undefined],
    ['zero', 0],
    ['negative', -1],
    ['non-integer', 1.5],
  ])('refuses maxAttemptsPerDocSet when %s', (_label, value) => {
    const config = { ...VALID_CONFIG, maxAttemptsPerDocSet: value };

    expect(() => parseSumsubConfig(config)).toThrow(KycConfigInvalidError);
    expect(() => parseSumsubConfig(config)).toThrow(/maxAttemptsPerDocSet/);
  });

  describe('document mapping', () => {
    it('parses a two-entry list to its typed shape', () => {
      const config = { ...VALID_CONFIG, documents: [VALID_DOCUMENT, VALID_SECOND_DOCUMENT] };

      const parsed = parseSumsubConfig(config);

      expect(parsed.documents).toEqual([
        {
          payloadField: 'idFrontDocumentId',
          idDocSetType: 'IDENTITY',
          idDocType: 'ID_CARD',
          idDocSubType: 'FRONT_SIDE',
          country: 'PL',
          countryField: undefined,
          optional: false,
        },
        {
          payloadField: 'idBackDocumentId',
          idDocSetType: 'IDENTITY',
          idDocType: 'ID_CARD',
          idDocSubType: 'BACK_SIDE',
          country: 'PL',
          countryField: undefined,
          optional: false,
        },
      ]);
    });

    it.each(['payloadField', 'idDocSetType', 'idDocType', 'country'])(
      'refuses an entry missing %s',
      (missingKey) => {
        const incompleteDocument: Record<string, unknown> = { ...VALID_DOCUMENT };
        delete incompleteDocument[missingKey];
        const config = { ...VALID_CONFIG, documents: [incompleteDocument] };

        expect(() => parseSumsubConfig(config)).toThrow(KycConfigInvalidError);
      },
    );

    it('accepts countryField in place of a fixed country', () => {
      const document: Record<string, unknown> = { ...VALID_DOCUMENT };
      delete document.country;
      const config = {
        ...VALID_CONFIG,
        documents: [{ ...document, countryField: 'documentIssuingCountry' }],
      };

      expect(parseSumsubConfig(config).documents[0]).toMatchObject({
        countryField: 'documentIssuingCountry',
        country: undefined,
      });
    });

    it('refuses an entry declaring both country and countryField', () => {
      const document = { ...VALID_DOCUMENT, countryField: 'documentIssuingCountry' };

      expect(() => parseSumsubConfig({ ...VALID_CONFIG, documents: [document] })).toThrow(
        KycConfigInvalidError,
      );
    });

    it('refuses an entry declaring neither country nor countryField', () => {
      const document: Record<string, unknown> = { ...VALID_DOCUMENT };
      delete document.country;

      expect(() => parseSumsubConfig({ ...VALID_CONFIG, documents: [document] })).toThrow(
        KycConfigInvalidError,
      );
    });

    it('accepts idDocSubType absent', () => {
      const selfieDocument: Record<string, unknown> = { ...VALID_DOCUMENT };
      delete selfieDocument.idDocSubType;
      const config = {
        ...VALID_CONFIG,
        documents: [{ ...selfieDocument, idDocSetType: 'SELFIE', idDocType: 'SELFIE' }],
      };

      const parsed = parseSumsubConfig(config);

      expect(parsed.documents[0]?.idDocSubType).toBeUndefined();
    });

    it('accepts two entries sharing one idDocSetType', () => {
      const config = { ...VALID_CONFIG, documents: [VALID_DOCUMENT, VALID_SECOND_DOCUMENT] };

      const parsed = parseSumsubConfig(config);

      expect(parsed.documents.map((document) => document.idDocSetType)).toEqual([
        'IDENTITY',
        'IDENTITY',
      ]);
    });
  });
});

describe('parseSumsubProviderConfig', () => {
  it('reads the two keys only Sumsub uses', () => {
    expect(
      parseSumsubProviderConfig({
        levelName: ' individual-standard-v2 ',
        questionnaireDefinitionId: 'onboardingQuestionnaire',
      }),
    ).toEqual({
      levelName: 'individual-standard-v2',
      questionnaireDefinitionId: 'onboardingQuestionnaire',
    });
  });

  it.each(['levelName', 'questionnaireDefinitionId'])('refuses a missing %s', (missingKey) => {
    const providerConfig: Record<string, unknown> = {
      levelName: 'individual-standard-v2',
      questionnaireDefinitionId: 'onboardingQuestionnaire',
    };
    delete providerConfig[missingKey];

    expect(() => parseSumsubProviderConfig(providerConfig)).toThrow(
      `Invalid sumsub_kyc connector config key "${missingKey}": must be a non-empty string`,
    );
  });
});
