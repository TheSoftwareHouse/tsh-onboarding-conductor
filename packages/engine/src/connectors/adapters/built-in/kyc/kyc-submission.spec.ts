import type { ConnectorExecutionInput } from '../../../ports/connector-adapter.port';
import { parseKycConfig } from './kyc-config';
import { KycCountryInvalidError } from './kyc-country';
import {
  buildKycApplicant,
  buildKycSubmission,
  KycApplicantPayloadInvalidError,
} from './kyc-submission';

const CONNECTOR_ID = 'test_kyc';
const ONBOARDING_ID = 'onboarding-1';

const FRONT = {
  payloadField: 'idFrontDocumentId',
  idDocSetType: 'IDENTITY',
  idDocType: 'ID_CARD',
  idDocSubType: 'FRONT_SIDE',
  country: 'POL',
};

const SELFIE = {
  payloadField: 'selfieDocumentId',
  idDocSetType: 'SELFIE',
  idDocType: 'SELFIE',
  country: 'PL',
  optional: true,
};

const CONFIG = parseKycConfig(CONNECTOR_ID, {
  sourceKey: 'source',
  documents: [FRONT],
  questionnairePathMap: { purposeOfAccount: 'purpose.accountPurpose' },
  maxAttemptsPerDocSet: 3,
  levelName: 'level-1',
});

const PAYLOAD: Readonly<Record<string, unknown>> = {
  firstName: ' Jan ',
  lastName: 'Kowalski',
  dateOfBirth: '1990-01-01',
  nationality: 'pl',
  country: 'PL',
  street: 'Main Street 1',
  town: 'Warsaw',
  postCode: '00-001',
  idFrontDocumentId: 'document-1',
  purposeOfAccount: 'savings',
};

const createInput = (
  payload: Readonly<Record<string, unknown>> = PAYLOAD,
  payloadFieldSources: Readonly<Record<string, string>> = {},
): ConnectorExecutionInput => ({
  declaration: { order: 1, config: {} },
  execution: { onboardingId: ONBOARDING_ID, stepName: 'kyc' },
  context: {},
  payload,
  payloadFieldSources,
});

const createDeps = () => ({
  documentResolver: {
    resolve: jest.fn().mockResolvedValue({
      finalObjectKey: 'onboardings/onboarding-1/document-1/final',
      verifiedEtag: '"etag-1"',
      verifiedSizeBytes: 128,
      contentType: 'image/png',
    }),
  },
  objectStoragePort: {
    readObject: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
  },
});

const submit = (deps: ReturnType<typeof createDeps>, config = CONFIG, input = createInput()) =>
  buildKycSubmission(
    CONNECTOR_ID,
    config,
    input,
    deps.documentResolver as never,
    deps.objectStoragePort as never,
  );

describe('buildKycApplicant', () => {
  it('reads the eight roles, trimming strings and keeping countries as upper-case alpha-2', () => {
    expect(buildKycApplicant(CONNECTOR_ID, PAYLOAD)).toEqual({
      firstName: 'Jan',
      lastName: 'Kowalski',
      dateOfBirth: '1990-01-01',
      nationality: 'PL',
      country: 'PL',
      street: 'Main Street 1',
      town: 'Warsaw',
      postCode: '00-001',
    });
  });

  it('leaves the address roles absent when the payload has none', () => {
    const applicant = buildKycApplicant(CONNECTOR_ID, {
      ...PAYLOAD,
      street: undefined,
      town: '  ',
      postCode: 42,
    });

    expect(applicant.street).toBeUndefined();
    expect(applicant.town).toBeUndefined();
    expect(applicant.postCode).toBeUndefined();
  });

  it.each(['firstName', 'lastName', 'dateOfBirth', 'nationality', 'country'])(
    'refuses a payload missing %s, naming the connector and the field',
    (missingKey) => {
      const payload: Record<string, unknown> = { ...PAYLOAD };
      delete payload[missingKey];

      expect(() => buildKycApplicant(CONNECTOR_ID, payload)).toThrow(
        KycApplicantPayloadInvalidError,
      );
      expect(() => buildKycApplicant(CONNECTOR_ID, payload)).toThrow(
        `Missing required test_kyc applicant field "${missingKey}"`,
      );
    },
  );

  it('refuses a blank required string', () => {
    expect(() => buildKycApplicant(CONNECTOR_ID, { ...PAYLOAD, lastName: '   ' })).toThrow(
      KycApplicantPayloadInvalidError,
    );
  });

  it.each(['nationality', 'country'])('refuses an unassigned %s code', (key) => {
    expect(() => buildKycApplicant(CONNECTOR_ID, { ...PAYLOAD, [key]: 'ZZ' })).toThrow(
      KycCountryInvalidError,
    );
  });
});

describe('buildKycSubmission', () => {
  it('assembles the applicant, documents, questionnaire and provider config', async () => {
    const deps = createDeps();

    const submission = await submit(deps);

    expect(submission).toEqual({
      onboardingId: ONBOARDING_ID,
      sourceKey: 'source',
      providerConfig: { levelName: 'level-1' },
      applicant: expect.objectContaining({ lastName: 'Kowalski', nationality: 'PL' }),
      documents: [
        {
          documentId: 'document-1',
          sourceField: 'idFrontDocumentId',
          docSet: 'IDENTITY',
          docType: 'ID_CARD',
          side: 'FRONT_SIDE',
          country: 'PL',
          contentType: 'image/png',
          content: Buffer.from([1, 2, 3]),
        },
      ],
      questionnaire: {
        pathMap: { purposeOfAccount: 'purpose.accountPurpose' },
        answers: { purposeOfAccount: 'savings' },
      },
    });
  });

  it('reads each document from storage with the resolved etag and size', async () => {
    const deps = createDeps();

    await submit(deps);

    expect(deps.objectStoragePort.readObject).toHaveBeenCalledWith({
      objectKey: 'onboardings/onboarding-1/document-1/final',
      expectedEtag: '"etag-1"',
      maxBytes: 128,
    });
  });

  it('resolves a document through its payloadFieldSources entry, else its own payload field', async () => {
    const deps = createDeps();

    await submit(deps, CONFIG, createInput(PAYLOAD, { idFrontDocumentId: 'identityDocument' }));
    await submit(deps);

    expect(deps.documentResolver.resolve).toHaveBeenNthCalledWith(1, {
      documentId: 'document-1',
      onboardingId: ONBOARDING_ID,
      sourceField: 'identityDocument',
    });
    expect(deps.documentResolver.resolve).toHaveBeenNthCalledWith(2, {
      documentId: 'document-1',
      onboardingId: ONBOARDING_ID,
      sourceField: 'idFrontDocumentId',
    });
  });

  it('skips an optional document the applicant supplied nothing for', async () => {
    const deps = createDeps();
    const config = parseKycConfig(CONNECTOR_ID, {
      sourceKey: 'source',
      documents: [FRONT, SELFIE],
      maxAttemptsPerDocSet: 3,
    });

    const submission = await submit(deps, config);

    expect(submission?.documents.map((document) => document.docSet)).toEqual(['IDENTITY']);
    expect(deps.documentResolver.resolve).toHaveBeenCalledTimes(1);
  });

  it('is undefined when every document is optional and absent', async () => {
    const deps = createDeps();
    const config = parseKycConfig(CONNECTOR_ID, {
      sourceKey: 'source',
      documents: [SELFIE],
      maxAttemptsPerDocSet: 3,
    });

    expect(await submit(deps, config)).toBeUndefined();
  });

  it('is undefined when a document fails to resolve', async () => {
    const deps = createDeps();
    deps.documentResolver.resolve.mockResolvedValueOnce(undefined);

    expect(await submit(deps)).toBeUndefined();
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['not a string', 42],
  ])('is undefined when a required document id is %s', async (_label, documentId) => {
    const deps = createDeps();

    const submission = await submit(
      deps,
      CONFIG,
      createInput({ ...PAYLOAD, idFrontDocumentId: documentId }),
    );

    expect(submission).toBeUndefined();
    expect(deps.objectStoragePort.readObject).not.toHaveBeenCalled();
  });

  it('reads no document at all when a later one cannot be mapped to a country', async () => {
    const deps = createDeps();
    const config = parseKycConfig(CONNECTOR_ID, {
      sourceKey: 'source',
      documents: [FRONT, { ...SELFIE, country: undefined, countryField: 'selfieCountry' }],
      maxAttemptsPerDocSet: 3,
    });

    await expect(
      submit(
        deps,
        config,
        createInput({ ...PAYLOAD, selfieDocumentId: 'document-2', selfieCountry: 'XX' }),
      ),
    ).rejects.toThrow(KycCountryInvalidError);
    expect(deps.documentResolver.resolve).not.toHaveBeenCalled();
  });

  describe('an applicant-supplied document country', () => {
    const configWithCountryField = parseKycConfig(CONNECTOR_ID, {
      sourceKey: 'source',
      documents: [{ ...FRONT, country: undefined, countryField: 'documentIssuingCountry' }],
      maxAttemptsPerDocSet: 3,
    });

    it.each([
      ['an alpha-2 code', 'FR'],
      ['a lowercase code', 'fr'],
      ['a padded code', '  FR  '],
    ])('normalises %s to upper-case alpha-2', async (_label, declared) => {
      const submission = await submit(
        createDeps(),
        configWithCountryField,
        createInput({ ...PAYLOAD, documentIssuingCountry: declared }),
      );

      expect(submission?.documents[0]?.country).toBe('FR');
    });

    it.each([
      ['missing', undefined, KycApplicantPayloadInvalidError],
      ['blank', '   ', KycApplicantPayloadInvalidError],
      ['not a string', 42, KycApplicantPayloadInvalidError],
      ['not an assigned ISO code', 'XX', KycCountryInvalidError],
    ])('refuses a %s issuing country', async (_label, declared, errorClass) => {
      const deps = createDeps();

      await expect(
        submit(
          deps,
          configWithCountryField,
          createInput({ ...PAYLOAD, documentIssuingCountry: declared }),
        ),
      ).rejects.toThrow(errorClass);
      expect(deps.documentResolver.resolve).not.toHaveBeenCalled();
    });
  });

  describe('the questionnaire', () => {
    it('is absent when the config has no questionnairePathMap', async () => {
      const config = parseKycConfig(CONNECTOR_ID, {
        sourceKey: 'source',
        documents: [FRONT],
        maxAttemptsPerDocSet: 3,
      });

      expect((await submit(createDeps(), config))?.questionnaire).toBeUndefined();
    });

    it('keeps strings and booleans and treats anything else as an unanswered conditional item', async () => {
      const config = parseKycConfig(CONNECTOR_ID, {
        sourceKey: 'source',
        documents: [FRONT],
        questionnairePathMap: {
          purposeOfAccount: 'purpose.accountPurpose',
          isPep: 'declarations.isPep',
          taxId: 'tax.id',
          note: 'tax.note',
        },
        maxAttemptsPerDocSet: 3,
      });

      const submission = await submit(
        createDeps(),
        config,
        createInput({ ...PAYLOAD, isPep: false, taxId: 12345, note: undefined }),
      );

      expect(submission?.questionnaire?.answers).toEqual({
        purposeOfAccount: 'savings',
        isPep: false,
        taxId: undefined,
        note: undefined,
      });
    });
  });
});
