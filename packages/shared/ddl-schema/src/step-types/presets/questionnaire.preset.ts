import type { FailWorkflow, StepFieldDescriptor } from '../step-type.port';

/**
 * One question. `path` is the `<section>.<item>` address a provider stores the answer at, so a
 * `kyc` step can build its whole `questionnairePathMap` from the sections a document declares
 * rather than from a hand-written table.
 */
export type QuestionnaireItemPreset = {
  readonly field: string;
  readonly path: string;
  readonly type: 'text' | 'boolean';
  readonly options?: readonly string[];
  readonly maxLength?: number;
};

export type QuestionnaireSectionPreset = {
  readonly key: string;
  readonly items: readonly QuestionnaireItemPreset[];
};

/** Bands, not amounts: an applicant does not know their exact monthly turnover, and a band is what a risk model consumes. */
const MONTHLY_AMOUNT_BANDS = ['lt_1k', '1k_5k', '5k_15k', '15k_50k', 'gt_50k'] as const;

/**
 * The questionnaire sections a financial onboarding asks about, with the option sets a regulated
 * one is expected to use: ISCO-08 major groups for occupation, and a source-of-funds list matching
 * the categories an EBA-aligned risk assessment expects.
 *
 * Presets rather than free config because these enums are the part authors get wrong: an
 * occupation list invented per workflow cannot be compared across workflows, and a risk model
 * reading it has to learn every variant.
 */
export const QUESTIONNAIRE_SECTIONS = [
  {
    key: 'purpose',
    items: [
      {
        field: 'accountPurpose',
        path: 'purpose.account_purpose',
        type: 'text',
        options: [
          'salary',
          'personal_spending',
          'savings',
          'marketplace_payouts',
          'travel',
          'remittance',
          'other',
        ],
      },
    ],
  },
  {
    key: 'employment',
    items: [
      {
        field: 'employmentStatus',
        path: 'employment.employment_status',
        type: 'text',
        options: ['employed', 'self_employed', 'student', 'retired', 'unemployed', 'other'],
      },
      {
        field: 'occupationGroup',
        path: 'employment.occupation_group',
        type: 'text',
        // ISCO-08 major groups 1-9 and 0 (armed forces), plus the two answers the standard has no
        // code for and a self-declaring applicant still needs.
        options: [
          'isco_1',
          'isco_2',
          'isco_3',
          'isco_4',
          'isco_5',
          'isco_6',
          'isco_7',
          'isco_8',
          'isco_9',
          'isco_0',
          'not_in_workforce',
          'other',
        ],
      },
      {
        field: 'occupationTitle',
        path: 'employment.occupation_title',
        type: 'text',
        maxLength: 100,
      },
    ],
  },
  {
    key: 'funds',
    items: [
      {
        field: 'sourceOfFunds',
        path: 'funds.source_of_funds',
        type: 'text',
        options: [
          'salary',
          'savings',
          'pension',
          'benefits',
          'investments',
          'sale_of_asset',
          'family_support',
          'other',
        ],
      },
      {
        field: 'monthlyIncomingBand',
        path: 'funds.monthly_in_band',
        type: 'text',
        options: MONTHLY_AMOUNT_BANDS,
      },
      {
        field: 'monthlyOutgoingBand',
        path: 'funds.monthly_out_band',
        type: 'text',
        options: MONTHLY_AMOUNT_BANDS,
      },
    ],
  },
  {
    key: 'declarations',
    items: [
      // No `options`: a boolean carries its own domain, and pinning it to `[true]` would refuse the
      // "no" this question exists to record.
      { field: 'pepSelfDeclared', path: 'declarations.pep_self_declared', type: 'boolean' },
    ],
  },
] as const satisfies readonly QuestionnaireSectionPreset[];

export type QuestionnaireSectionName = (typeof QUESTIONNAIRE_SECTIONS)[number]['key'];

export const QUESTIONNAIRE_SECTION_NAMES = QUESTIONNAIRE_SECTIONS.map((section) => section.key);

export const findQuestionnaireSection = (key: string): QuestionnaireSectionPreset | undefined =>
  QUESTIONNAIRE_SECTIONS.find((section) => section.key === key);

export const getQuestionnaireSection = (
  key: string,
  fail: FailWorkflow,
): QuestionnaireSectionPreset => findQuestionnaireSection(key) ?? fail('INVALID_VALUE');

/**
 * The field descriptor one item declares. Every question is required: a questionnaire whose
 * answers are optional cannot support the risk assessment it exists for, and a provider that
 * receives a partial one reports it as an incomplete applicant rather than a passing one.
 */
export const buildQuestionnaireField = (item: QuestionnaireItemPreset): StepFieldDescriptor => {
  if (item.type === 'boolean') {
    return { type: 'boolean', required: true };
  }

  if (item.options !== undefined) {
    return { type: 'text', required: true, validation: { oneOf: [...item.options] } };
  }

  return {
    type: 'text',
    required: true,
    validation: { minLength: 1, maxLength: item.maxLength ?? 100 },
  };
};
