import { SumsubConfigInvalidError } from './sumsub-config';
import {
  buildSumsubQuestionnaireBody,
  type SumsubQuestionnaireAnswers,
} from './sumsub-questionnaire';

const PATH_MAP: Readonly<Record<string, string>> = {
  accountPurpose: 'purpose.account_purpose',
  accountPurposeOther: 'purpose.account_purpose_other',
  employmentStatus: 'employment.employment_status',
  occupationGroup: 'employment.occupation_group',
  sourceOfFunds: 'funds.source_of_funds',
  pepSelfDeclared: 'declarations.pep_self_declared',
  pepRole: 'declarations.pep_role',
};

describe('buildSumsubQuestionnaireBody', () => {
  it('assembles a path map into sections/items', () => {
    const answers: SumsubQuestionnaireAnswers = {
      accountPurpose: 'salary',
      employmentStatus: 'employed',
      occupationGroup: 'isco_2',
      sourceOfFunds: 'salary',
      pepSelfDeclared: false,
    };

    const body = buildSumsubQuestionnaireBody(PATH_MAP, answers);

    expect(body).toEqual({
      sections: {
        purpose: { items: { account_purpose: { value: 'salary' } } },
        employment: {
          items: {
            employment_status: { value: 'employed' },
            occupation_group: { value: 'isco_2' },
          },
        },
        funds: { items: { source_of_funds: { value: 'salary' } } },
        declarations: { items: { pep_self_declared: { value: 'no' } } },
      },
    });
  });

  it('emits a false-equivalent answer as the string "no", never as a boolean', () => {
    const body = buildSumsubQuestionnaireBody(
      { pepSelfDeclared: 'declarations.pep_self_declared' },
      { pepSelfDeclared: false },
    );

    const value = body.sections.declarations?.items.pep_self_declared?.value;

    expect(value).toBe('no');
    expect(typeof value).toBe('string');
  });

  it('emits a true answer as the string "yes", never as a boolean', () => {
    const body = buildSumsubQuestionnaireBody(
      { pepSelfDeclared: 'declarations.pep_self_declared' },
      { pepSelfDeclared: true },
    );

    const value = body.sections.declarations?.items.pep_self_declared?.value;

    expect(value).toBe('yes');
    expect(typeof value).toBe('string');
  });

  it('omits a conditional item when its condition fails', () => {
    const answers: SumsubQuestionnaireAnswers = {
      accountPurpose: 'salary',
      // accountPurposeOther absent: purpose was not "other", so it was never captured.
    };

    const body = buildSumsubQuestionnaireBody(PATH_MAP, answers);

    expect(body.sections.purpose?.items.account_purpose_other).toBeUndefined();
  });

  it('includes a conditional item when its condition holds', () => {
    const answers: SumsubQuestionnaireAnswers = {
      accountPurpose: 'other',
      accountPurposeOther: 'crypto trading',
    };

    const body = buildSumsubQuestionnaireBody(PATH_MAP, answers);

    expect(body.sections.purpose?.items.account_purpose_other?.value).toBe('crypto trading');
  });

  it('treats an explicitly undefined answer the same as an absent one', () => {
    const body = buildSumsubQuestionnaireBody(
      { pepRole: 'declarations.pep_role' },
      { pepRole: undefined },
    );

    expect(body.sections.declarations).toBeUndefined();
  });

  it('refuses a path with no "." separator', () => {
    const pathMap = { accountPurpose: 'purpose' };

    expect(() => buildSumsubQuestionnaireBody(pathMap, { accountPurpose: 'salary' })).toThrow(
      SumsubConfigInvalidError,
    );
    expect(() => buildSumsubQuestionnaireBody(pathMap, { accountPurpose: 'salary' })).toThrow(
      /questionnairePathMap\.accountPurpose/,
    );
  });

  it('refuses a malformed path even when its answer is absent', () => {
    const pathMap = { accountPurpose: 'purpose' };

    expect(() => buildSumsubQuestionnaireBody(pathMap, {})).toThrow(SumsubConfigInvalidError);
  });

  it('returns an empty sections object when no answers are given', () => {
    const body = buildSumsubQuestionnaireBody(PATH_MAP, {});

    expect(body).toEqual({ sections: {} });
  });
});
