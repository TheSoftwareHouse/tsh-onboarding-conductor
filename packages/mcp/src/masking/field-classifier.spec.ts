import type { components } from '@tsh/openapi';
import { FieldClassifier, mergeFieldClassMaps, parsePassFields } from './field-classifier';
import { FieldClass, PseudonymFormat } from './masking.constants';
import type { ClassifiableWorkflowDocument, FieldShape } from './masking.types';

const COUNTRIES = ['PL', 'DE', 'RU'];

const profileStep: Record<string, FieldShape> = {
  firstName: { type: 'text', validation: { minLength: 1, maxLength: 100 } },
  lastName: { type: 'text', validation: { minLength: 1, maxLength: 100 } },
  dateOfBirth: { type: 'date', validation: { minAgeYears: 18, maxAgeYears: 120 } },
  nationality: { type: 'text', validation: { oneOf: COUNTRIES } },
  street: { type: 'text', validation: { minLength: 1, maxLength: 200 } },
  country: { type: 'text', validation: { oneOf: COUNTRIES } },
  sourceOfFunds: { type: 'text', validation: { oneOf: ['salary', 'other'] } },
  occupationTitle: { type: 'text', validation: { minLength: 1, maxLength: 100 } },
  pepSelfDeclared: { type: 'boolean' },
  email: { type: 'text', validation: { format: 'email' } },
  phoneNumber: { type: 'text', validation: { format: 'phone' } },
};

const document = (...steps: Record<string, FieldShape>[]): ClassifiableWorkflowDocument => ({
  steps: steps.map((data) => ({ data })),
});

describe('FieldClassifier', () => {
  const classify = (doc: ClassifiableWorkflowDocument, passFields: string[] = []) =>
    new FieldClassifier(passFields).classify(doc);

  it('accepts the compiled workflow document the engine returns', () => {
    const compiled = {} as components['schemas']['CompiledWorkflowDocument'];
    const accepted: ClassifiableWorkflowDocument = compiled;

    expect(accepted).toBe(compiled);
  });

  it('classifies the fields of an identity profile step by what the declaration proves', () => {
    const classes = classify(document(profileStep));

    expect(classes.get('firstName')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('lastName')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('street')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('occupationTitle')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('dateOfBirth')).toEqual({ class: FieldClass.GENERALISE });
    expect(classes.get('email')).toEqual({
      class: FieldClass.PSEUDONYMISE,
      format: PseudonymFormat.EMAIL,
    });
    expect(classes.get('phoneNumber')).toEqual({
      class: FieldClass.PSEUDONYMISE,
      format: PseudonymFormat.PHONE,
    });
    expect(classes.get('sourceOfFunds')).toEqual({ class: FieldClass.PASS });
    expect(classes.get('pepSelfDeclared')).toEqual({ class: FieldClass.PASS });
  });

  it('passes enumerated countries and a name the operator lists, and nothing else of that kind', () => {
    const doc = document({
      nationality: profileStep.nationality,
      region: { type: 'text', validation: { maxLength: 50 } },
      nickname: { type: 'text' },
    });

    const classes = classify(doc, ['region']);

    expect(classes.get('nationality')).toEqual({ class: FieldClass.PASS });
    expect(classes.get('region')).toEqual({ class: FieldClass.PASS });
    expect(classes.get('nickname')).toEqual({ class: FieldClass.DROP });
  });

  it('never passes a file, even one whose name is listed', () => {
    const classes = classify(
      document({
        identityDocument: { type: 'file', validation: { maxLength: 1 } },
        selfie: { type: 'file' },
      }),
      ['identityDocument'],
    );

    expect(classes.get('identityDocument')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('selfie')).toEqual({ class: FieldClass.DROP });
  });

  it('drops provider free text, numbers and other dates, and passes reason codes', () => {
    const classes = classify(
      document({
        kycCustomerMessage: { type: 'text' },
        kycReasonCodes: { type: 'array', items: { type: 'text' } },
        kycAttemptCount: { type: 'number' },
        kycOutcome: { type: 'text', validation: { oneOf: ['verified', 'review'] } },
        monthlyIncome: { type: 'number' },
        documentExpiry: { type: 'date' },
        birthDate: { type: 'date' },
        notes: { type: 'array', items: { type: 'text' } },
        flags: { type: 'array', items: { type: 'text', validation: { manyOf: ['a', 'b'] } } },
        address: { type: 'object' },
      }),
    );

    expect(classes.get('kycCustomerMessage')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('kycReasonCodes')).toEqual({ class: FieldClass.PASS });
    expect(classes.get('kycAttemptCount')).toEqual({ class: FieldClass.PASS });
    expect(classes.get('kycOutcome')).toEqual({ class: FieldClass.PASS });
    expect(classes.get('monthlyIncome')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('documentExpiry')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('birthDate')).toEqual({ class: FieldClass.GENERALISE });
    expect(classes.get('notes')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('flags')).toEqual({ class: FieldClass.PASS });
    expect(classes.get('address')).toEqual({ class: FieldClass.DROP });
  });

  it('drops a field whose type it does not know and a step with no data', () => {
    const classes = classify({
      steps: [{}, { data: { mystery: { type: 'hologram' } } }],
    });

    expect(classes.get('mystery')).toEqual({ class: FieldClass.DROP });
    expect(classes.get('anythingUndeclared')).toBeUndefined();
  });

  it('takes the stricter class when a field is declared twice', () => {
    const classes = classify(
      document(
        { code: { type: 'text', validation: { oneOf: ['a'] } } },
        { code: { type: 'text' } },
      ),
    );

    expect(classes.get('code')).toEqual({ class: FieldClass.DROP });
  });

  describe('mergeFieldClassMaps', () => {
    it('keeps the stricter class per name and drops conflicting pseudonym formats', () => {
      const merged = mergeFieldClassMaps([
        new Map([
          ['status', { class: FieldClass.PASS }],
          ['contact', { class: FieldClass.PSEUDONYMISE, format: PseudonymFormat.EMAIL }],
        ]),
        new Map([
          ['status', { class: FieldClass.DROP }],
          ['contact', { class: FieldClass.PSEUDONYMISE, format: PseudonymFormat.PHONE }],
          ['only', { class: FieldClass.GENERALISE }],
        ]),
      ]);

      expect(merged.get('status')).toEqual({ class: FieldClass.DROP });
      expect(merged.get('contact')).toEqual({ class: FieldClass.DROP });
      expect(merged.get('only')).toEqual({ class: FieldClass.GENERALISE });
    });
  });

  describe('parsePassFields', () => {
    it('splits on commas and trims blanks away', () => {
      expect(parsePassFields(' country, nationality ,, ')).toEqual(['country', 'nationality']);
      expect(parsePassFields('')).toEqual([]);
    });
  });
});
