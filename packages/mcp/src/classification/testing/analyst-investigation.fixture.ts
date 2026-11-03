import type { FieldShape } from '../../masking/masking.types';

/** A field as the engine's dry-run compile reports it: the classifier's view plus what it adds. */
type CompiledField = FieldShape & { required: boolean; persist?: boolean };

interface CompiledWorkflowFixture {
  steps: Array<{ name: string; data: Record<string, CompiledField> }>;
}

/** Each compiled step of `analyst-investigation` v1 with its field declarations, from a live dry-run compile. */
export const ANALYST_INVESTIGATION_COMPILED: CompiledWorkflowFixture = {
  steps: [
    {
      name: 'collect_profile',
      data: {
        firstName: { type: 'text', required: true, validation: { minLength: 1, maxLength: 100 } },
        lastName: { type: 'text', required: true, validation: { minLength: 1, maxLength: 100 } },
        dateOfBirth: {
          type: 'date',
          required: true,
          validation: { minAgeYears: 18, maxAgeYears: 120 },
        },
        nationality: {
          type: 'text',
          required: true,
          validation: {
            oneOf: ['PL', 'DE', 'FR', 'ES', 'IT', 'NL', 'IE', 'SE', 'GB', 'TR', 'AE', 'RU', 'IR'],
          },
        },
        street: { type: 'text', required: true, validation: { minLength: 1, maxLength: 200 } },
        town: { type: 'text', required: true, validation: { minLength: 1, maxLength: 100 } },
        postCode: { type: 'text', required: true, validation: { minLength: 1, maxLength: 20 } },
        country: {
          type: 'text',
          required: true,
          validation: {
            oneOf: ['PL', 'DE', 'FR', 'ES', 'IT', 'NL', 'IE', 'SE', 'GB', 'TR', 'AE', 'RU', 'IR'],
          },
        },
        accountPurpose: {
          type: 'text',
          required: true,
          validation: {
            oneOf: [
              'salary',
              'personal_spending',
              'savings',
              'marketplace_payouts',
              'travel',
              'remittance',
              'other',
            ],
          },
        },
        employmentStatus: {
          type: 'text',
          required: true,
          validation: {
            oneOf: ['employed', 'self_employed', 'student', 'retired', 'unemployed', 'other'],
          },
        },
        occupationGroup: {
          type: 'text',
          required: true,
          validation: {
            oneOf: [
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
        },
        occupationTitle: {
          type: 'text',
          required: true,
          validation: { minLength: 1, maxLength: 100 },
        },
        sourceOfFunds: {
          type: 'text',
          required: true,
          validation: {
            oneOf: [
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
        },
        monthlyIncomingBand: {
          type: 'text',
          required: true,
          validation: { oneOf: ['lt_1k', '1k_5k', '5k_15k', '15k_50k', 'gt_50k'] },
        },
        monthlyOutgoingBand: {
          type: 'text',
          required: true,
          validation: { oneOf: ['lt_1k', '1k_5k', '5k_15k', '15k_50k', 'gt_50k'] },
        },
        pepSelfDeclared: { type: 'boolean', required: true },
        email: { type: 'text', required: true, validation: { format: 'email' } },
        phoneNumber: { type: 'text', required: true, validation: { format: 'phone' } },
      },
    },
    { name: 'send_email_code', data: {} },
    {
      name: 'verify_email_code',
      data: {
        verificationCode: {
          type: 'text',
          required: true,
          persist: false,
          validation: { pattern: '^[0-9]{4,10}$' },
        },
      },
    },
    { name: 'resend_email_code', data: {} },
    {
      name: 'upload_identity_document',
      data: {
        identityDocument: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/jpeg', 'application/pdf'],
            maxSizeBytes: 10485760,
          },
        },
      },
    },
    {
      name: 'check_identity',
      data: {
        providerVerdict: {
          type: 'text',
          required: false,
          validation: { oneOf: ['approve', 'review'] },
        },
      },
    },
    { name: 'review_identity', data: {} },
    { name: 'approved', data: {} },
    { name: 'rejected', data: {} },
    { name: 'invalid', data: {} },
  ],
};
