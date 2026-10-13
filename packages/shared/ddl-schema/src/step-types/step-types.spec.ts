import { compileWorkflow } from './workflow.compiler';
import type { RawWorkflowStep } from '../workflow-contract';
import { validateAndNormalizeWorkflow } from '../workflow-validator';
import { EEA_ID_CARD_ISSUERS, EEA_MEMBER_STATES } from './presets/country.preset';
import type { RawWorkflowField, CompiledWorkflowStep } from '../workflow-contract';

/**
 * Reads a type-specific member off a field descriptor. The envelope type declares only what every
 * type shares, so `validation` lives on the field-type module that owns it and has to be read out.
 */
const validationOf = (field: RawWorkflowField): Record<string, unknown> =>
  (field as { validation?: Record<string, unknown> }).validation ?? {};

const terminal = (name: string, outcome = 'approved'): RawWorkflowStep => ({
  name,
  type: 'terminal',
  config: { outcome },
});

/**
 * Compiles a workflow around one step and returns the compiled steps that step produced. The three
 * terminals and any `extra` step compile to one step each, named after themselves, so those are
 * what gets dropped.
 */
const compileStep = (
  step: RawWorkflowStep,
  extra: readonly RawWorkflowStep[] = [],
): CompiledWorkflowStep[] => {
  const scaffolding = [
    terminal('done'),
    terminal('refused', 'rejected'),
    terminal('void', 'invalid'),
    ...extra,
  ];
  const scaffoldingNames = new Set(scaffolding.map((candidate) => candidate.name));
  const compiled = compileWorkflow({
    id: 'single',
    version: 1,
    steps: [step, ...scaffolding],
  });

  return compiled.steps.filter((step) => !scaffoldingNames.has(step.name));
};

describe('consents', () => {
  it('pins each version as the only accepted value and names the acknowledgement after its verb', () => {
    const [step] = compileStep({
      name: 'agree',
      type: 'consents',
      config: {
        consents: [
          { key: 'terms', version: '2026-07-01', acknowledgement: 'accepted' },
          { key: 'privacyNotice', version: '2026-07-01', acknowledgement: 'acknowledged' },
          { key: 'marketing', acknowledgement: 'consent', required: false },
        ],
      },
      edges: { success: 'done' },
    });

    expect(step.data).toEqual({
      termsVersion: { type: 'text', required: true, validation: { oneOf: ['2026-07-01'] } },
      termsAccepted: { type: 'boolean', required: true, validation: { oneOf: [true] } },
      privacyNoticeVersion: { type: 'text', required: true, validation: { oneOf: ['2026-07-01'] } },
      privacyNoticeAcknowledged: {
        type: 'boolean',
        required: true,
        validation: { oneOf: [true] },
      },
      // Optional, so no `oneOf`: refusing marketing is an answer, not a failure to answer.
      marketingConsent: { type: 'boolean', required: false },
    });
  });
});

describe('identity-profile and address', () => {
  it('emits canonical names and bounds age in years from the day of submission', () => {
    const [step] = compileStep({
      name: 'who',
      type: 'identity-profile',
      config: { nationalities: 'eea', minAgeYears: 18, maxAgeYears: 120 },
      edges: { success: 'done' },
    });

    expect(step.data.dateOfBirth).toEqual({
      type: 'date',
      required: true,
      validation: { minAgeYears: 18, maxAgeYears: 120 },
    });
    expect(step.data.nationality).toEqual({
      type: 'text',
      required: true,
      validation: { oneOf: [...EEA_MEMBER_STATES] },
    });
    // Optional middle names carry no lower bound: an unanswered field is absent, never empty.
    expect(step.data.middleNames).toEqual({
      type: 'text',
      required: false,
      validation: { maxLength: 100 },
    });
  });

  it('leaves region and second street line out unless asked for', () => {
    const [step] = compileStep({
      name: 'where',
      type: 'address',
      config: { countries: ['FR'] },
      edges: { success: 'done' },
    });

    expect(Object.keys(step.data)).toEqual(['street', 'town', 'postCode', 'country']);
  });
});

describe('document-choice', () => {
  it('gates each issuing country on the choice and routes with no catch-all arm', () => {
    const [step] = compileStep(
      {
        name: 'pick',
        type: 'document-choice',
        config: {
          documents: [
            { type: 'PASSPORT', countries: 'eea' },
            { type: 'ID_CARD', countries: 'eea-id-card-issuers' },
          ],
        },
        edges: { PASSPORT: 'passport', ID_CARD: 'done' },
      },
      [
        {
          name: 'passport',
          type: 'document-capture',
          config: { document: 'PASSPORT' },
          edges: { success: 'done' },
        },
      ],
    );

    expect(step.data.documentType).toEqual({
      type: 'text',
      required: true,
      validation: { oneOf: ['PASSPORT', 'ID_CARD'] },
    });
    expect(step.data.idCardIssuingCountry).toEqual({
      type: 'text',
      required: true,
      when: { field: 'documentType', equals: 'ID_CARD' },
      validation: { oneOf: [...EEA_ID_CARD_ISSUERS] },
    });
    expect(step.transitions).toEqual([
      {
        status: 'success',
        when: { field: 'documentType', equals: 'PASSPORT' },
        target: 'passport',
      },
      { status: 'success', when: { field: 'documentType', equals: 'ID_CARD' }, target: 'done' },
    ]);
  });

  it('asks a single offered document of everyone, ungated', () => {
    const [step] = compileStep({
      name: 'pick',
      type: 'document-choice',
      config: { documents: [{ type: 'PASSPORT', countries: ['FR'] }] },
      edges: { PASSPORT: 'done' },
    });

    expect(step.data.passportIssuingCountry.when).toBeUndefined();
  });
});

describe('document-capture', () => {
  it('splits a two-sided document across two steps and wires the second itself', () => {
    const steps = compileStep({
      name: 'card',
      type: 'document-capture',
      config: { document: 'ID_CARD', sides: 2 },
      edges: { success: 'done' },
    });

    expect(steps.map((step) => step.name)).toEqual(['card_front', 'card_back']);
    expect(Object.keys(steps[0].data)).toEqual(['idCardFront']);
    expect(Object.keys(steps[1].data)).toEqual(['idCardBack']);
    expect(steps[0].transitions[0].target).toBe('card_back');
    expect(steps[1].transitions[0].target).toBe('done');
  });

  it('accepts a scan or a photo for a document, and only a photo for a selfie', () => {
    const [document] = compileStep({
      name: 'passport',
      type: 'document-capture',
      config: { document: 'PASSPORT' },
      edges: { success: 'done' },
    });
    const [selfie] = compileStep({
      name: 'face',
      type: 'selfie-capture',
      edges: { success: 'done' },
    });

    expect(validationOf(document.data.passportDocument).contentTypes).toEqual([
      'image/png',
      'image/jpeg',
      'application/pdf',
    ]);
    expect(validationOf(selfie.data.selfieDocument).contentTypes).toEqual([
      'image/png',
      'image/jpeg',
    ]);
  });
});

describe('contact-details', () => {
  it('asks for both channels by default, under the names a verification step looks for', () => {
    const [step] = compileStep({
      name: 'contact',
      type: 'contact-details',
      edges: { success: 'done' },
    });

    expect(step.data).toEqual({
      email: { type: 'text', required: true, validation: { format: 'email' } },
      phoneNumber: { type: 'text', required: true, validation: { format: 'phone' } },
    });
  });

  it('leaves out a channel the config omits and relaxes one it makes optional', () => {
    const [step] = compileStep({
      name: 'contact',
      type: 'contact-details',
      config: { email: 'optional', phoneNumber: 'omitted' },
      edges: { success: 'done' },
    });

    expect(Object.keys(step.data)).toEqual(['email']);
    expect(step.data.email.required).toBe(false);
  });

  it('refuses to collect nothing', () => {
    expect(() =>
      compileStep({
        name: 'contact',
        type: 'contact-details',
        config: { email: 'omitted', phoneNumber: 'omitted' },
        edges: { success: 'done' },
      }),
    ).toThrow('WORKFLOW_INVALID');
  });
});

describe('otp-verify', () => {
  /** A contact collector, then the challenge: the recipient comes from the role, not from config. */
  const compileOtp = (): CompiledWorkflowStep[] =>
    compileWorkflow({
      id: 'otp',
      version: 1,
      steps: [
        {
          name: 'contact',
          type: 'contact-details',
          config: { email: 'omitted' },
          edges: { success: 'phone' },
        },
        {
          name: 'phone',
          type: 'otp-verify',
          config: {
            channel: 'sms',
            connector: {
              id: 'twilio_verify',
              startConfig: { operation: 'startVerification' },
              checkConfig: { operation: 'checkVerification' },
            },
          },
          edges: { verified: 'done', refused: 'refused' },
        },
        terminal('done'),
        terminal('refused', 'rejected'),
      ],
    }).steps.slice(1, 4);

  it('sends, checks and re-sends, wiring the two internal edges itself', () => {
    const [send, verify, resend] = compileOtp();

    expect(send.transitions).toEqual([{ status: 'success', target: 'phone_verify' }]);
    expect(resend.transitions).toEqual([{ status: 'success', target: 'phone_verify' }]);
    expect(resend.connectors?.[0].config).toEqual({ operation: 'startVerification' });
    expect(verify.connectors?.[0].config).toEqual({ operation: 'checkVerification' });
  });

  it('routes a stale challenge back to the re-send and everything else to the refusal', () => {
    const [, verify] = compileOtp();

    expect(verify.transitions).toEqual([
      { status: 'success', target: 'done' },
      {
        status: 'rejected',
        reason: ['CHALLENGE_EXPIRED', 'CHALLENGE_NOT_FOUND'],
        target: 'phone_resend',
      },
      { status: 'rejected', target: 'refused' },
    ]);
    // Only the check can refuse; a send either reaches the provider or fails as an integration error.
    expect(verify.connectors?.[0].canReject).toBe(true);
  });

  it('collects nothing itself and challenges the number a collector published', () => {
    const [send, verify] = compileOtp();

    expect(send.data).toEqual({});
    expect(send.connectors?.[0].fieldMapping).toEqual({ recipient: 'phoneNumber' });
    expect(verify.connectors?.[0].fieldMapping).toEqual({
      recipient: 'phoneNumber',
      code: 'verificationCode',
    });
    expect(verify.data.verificationCode.persist).toBe(false);
  });

  it('refuses to compile when nothing before it collects the channel it is meant to prove', () => {
    expect(() =>
      compileStep({
        name: 'phone',
        type: 'otp-verify',
        config: { channel: 'email', connector: { id: 'mock_email_verification' } },
        edges: { verified: 'done', refused: 'refused' },
      }),
    ).toThrow('WORKFLOW_INVALID');
  });

  it('adds the author extra payload keys beside its own, and refuses one that overrides its own', () => {
    const withExtra = compileStep({
      name: 'phone',
      type: 'otp-verify',
      config: {
        channel: 'sms',
        recipientField: 'phoneNumber',
        connector: { id: 'twilio_verify', fieldMapping: { locale: 'preferredLanguage' } },
      },
      edges: { verified: 'done', refused: 'refused' },
    });

    expect(withExtra[0].connectors?.[0].fieldMapping).toEqual({
      recipient: 'phoneNumber',
      locale: 'preferredLanguage',
    });
    expect(() =>
      compileStep({
        name: 'phone',
        type: 'otp-verify',
        config: {
          channel: 'sms',
          recipientField: 'phoneNumber',
          connector: { id: 'twilio_verify', fieldMapping: { recipient: 'somethingElse' } },
        },
        edges: { verified: 'done', refused: 'refused' },
      }),
    ).toThrow('WORKFLOW_INVALID');
  });
});

/** An OTP challenge with the given binding, compiled behind a phone collector: send, check, re-send. */
const compileOtpWith = (connector: Record<string, unknown>): CompiledWorkflowStep[] =>
  compileWorkflow({
    id: 'otp',
    version: 1,
    steps: [
      {
        name: 'contact',
        type: 'contact-details',
        config: { email: 'omitted' },
        edges: { success: 'phone' },
      },
      {
        name: 'phone',
        type: 'otp-verify',
        config: { channel: 'sms', connector },
        edges: { verified: 'done', refused: 'refused' },
      },
      terminal('done'),
      terminal('refused', 'rejected'),
    ],
  }).steps.slice(1, 4);

describe('a step connector slot', () => {
  it.each([
    [
      'otp-verify',
      {
        channel: 'sms',
        recipientField: 'phoneNumber',
        connector: { id: 'sumsub_kyc', type: 'kyc' },
      },
      { verified: 'done', refused: 'refused' },
    ],
    [
      'notify',
      { connector: { id: 'sumsub_kyc', type: 'kyc' }, recipientField: 'email' },
      { success: 'done' },
    ],
    [
      'http-call',
      {
        connector: { id: 'sendgrid_email', type: 'email_delivery' },
        request: { url: 'https://x' },
      },
      { success: 'done' },
    ],
  ] as const)(
    'refuses a %s step bound to a connector of the wrong capability',
    (type, config, edges) => {
      expect(() =>
        compileStep({
          name: 'step',
          type,
          config: config as Record<string, unknown>,
          edges: { ...edges },
        }),
      ).toThrow('WORKFLOW_INVALID');
    },
  );

  it('assumes the capability that follows from the channel, and lets the author say the other', () => {
    const [sms] = compileStep({
      name: 'phone',
      type: 'otp-verify',
      config: { channel: 'sms', recipientField: 'phoneNumber', connector: { id: 'twilio_verify' } },
      edges: { verified: 'done', refused: 'refused' },
    });
    const [email] = compileStep({
      name: 'mail',
      type: 'otp-verify',
      config: {
        channel: 'email',
        recipientField: 'email',
        connector: { id: 'mock_email_verification' },
      },
      edges: { verified: 'done', refused: 'refused' },
    });

    expect(sms.connectors?.[0].type).toBe('phone_verification');
    expect(email.connectors?.[0].type).toBe('email_verification');
  });
});

describe('kyc-identity-verification', () => {
  const compiled = compileWorkflow({
    id: 'kyc',
    version: 1,
    steps: [
      {
        name: 'who',
        type: 'identity-profile',
        config: { nationalities: ['FR'] },
        include: [
          { type: 'address', config: { countries: ['FR'] } },
          { type: 'questionnaire', config: { sections: ['purpose'] } },
        ],
        edges: { success: 'pick' },
      },
      {
        name: 'pick',
        type: 'document-choice',
        config: {
          documents: [
            { type: 'PASSPORT', countries: ['FR'] },
            { type: 'ID_CARD', countries: ['FR'] },
          ],
        },
        edges: { PASSPORT: 'passport', ID_CARD: 'card' },
      },
      {
        name: 'passport',
        type: 'document-capture',
        config: { document: 'PASSPORT' },
        edges: { success: 'face' },
      },
      {
        name: 'card',
        type: 'document-capture',
        config: { document: 'ID_CARD', sides: 2 },
        edges: { success: 'face' },
      },
      { name: 'face', type: 'selfie-capture', edges: { success: 'check' } },
      {
        name: 'check',
        type: 'kyc-identity-verification',
        config: {
          connector: { id: 'sumsub_kyc' },
          levelName: 'level',
          sourceKey: 'source',
          questionnaireDefinitionId: 'questions',
          maxAttemptsPerDocSet: 3,
        },
        edges: {
          verified: 'done',
          review: 'review',
          'retry.IDENTITY': 'pick',
          'retry.SELFIE': 'face',
          'retry.APPLICANT_DATA': 'review',
          'retry.QUESTIONNAIRE': 'who',
          refused: 'refused',
        },
      },
      {
        name: 'review',
        type: 'manual-review',
        edges: { approve: 'done', reject: 'refused', invalid: 'void' },
      },
      terminal('done'),
      terminal('refused', 'rejected'),
      terminal('void', 'invalid'),
    ],
  });
  const connector = compiled.steps.find((step) => step.name === 'check')!.connectors![0];

  it('builds its applicant mapping from the canonical roles its neighbours published', () => {
    expect(connector.fieldMapping).toMatchObject({
      firstName: 'firstName',
      lastName: 'lastName',
      dateOfBirth: 'dateOfBirth',
      nationality: 'nationality',
      country: 'country',
      street: 'street',
      town: 'town',
      postCode: 'postCode',
      accountPurpose: 'accountPurpose',
    });
    // Collected for the record, never submitted: the provider compares against the document's own names.
    expect(connector.fieldMapping).not.toHaveProperty('middleNames');
  });

  it('builds its document table from the capture and choice steps, joined on document type', () => {
    expect(connector.config?.documents).toEqual([
      {
        payloadField: 'passportDocumentId',
        idDocSetType: 'IDENTITY',
        idDocType: 'PASSPORT',
        countryField: 'passportIssuingCountry',
        optional: true,
      },
      {
        payloadField: 'idCardFrontId',
        idDocSetType: 'IDENTITY',
        idDocType: 'ID_CARD',
        idDocSubType: 'FRONT_SIDE',
        countryField: 'idCardIssuingCountry',
        optional: true,
      },
      {
        payloadField: 'idCardBackId',
        idDocSetType: 'IDENTITY',
        idDocType: 'ID_CARD',
        idDocSubType: 'BACK_SIDE',
        countryField: 'idCardIssuingCountry',
        optional: true,
      },
      // No state issues a selfie, so it takes the applicant's residence and is never optional.
      {
        payloadField: 'selfieDocumentId',
        idDocSetType: 'SELFIE',
        idDocType: 'SELFIE',
        countryField: 'country',
      },
    ]);
  });

  it('puts every branch-only source in the optional mapping and the rest in the required one', () => {
    expect(connector.optionalFieldMapping).toEqual({
      passportIssuingCountry: 'passportIssuingCountry',
      idCardIssuingCountry: 'idCardIssuingCountry',
      passportDocumentId: 'passportDocument',
      idCardFrontId: 'idCardFront',
      idCardBackId: 'idCardBack',
    });
    expect(connector.fieldMapping.selfieDocumentId).toBe('selfieDocument');
  });

  it('derives the questionnaire paths from the sections the document asks', () => {
    expect(connector.config?.questionnairePathMap).toEqual({
      accountPurpose: 'purpose.account_purpose',
    });
  });

  it('parks on the callback and declares every field it can carry', () => {
    const step = compiled.steps.find((candidate) => candidate.name === 'check')!;

    expect(connector.async).toBe(true);
    expect(Object.keys(step.data)).toEqual([
      'kycOutcome',
      'kycRetryStep',
      'kycReasonCodes',
      'kycCustomerMessage',
      'kycAttemptCount',
    ]);
    expect(step.data.kycAttemptCount).toMatchObject({ type: 'number', required: false });
    // Uncapped: a reviewer's comment has no length guarantee, and a cap loses the verdict.
    expect(validationOf(step.data.kycCustomerMessage)).toEqual({});
  });

  it('routes each outcome on its own arm and refuses only what nothing else claimed', () => {
    const step = compiled.steps.find((candidate) => candidate.name === 'check')!;

    expect(step.transitions.map((transition) => transition.target)).toEqual([
      'done',
      'review',
      'pick',
      'face',
      'review',
      'who',
      'refused',
    ]);
    expect(step.transitions[6]).toEqual({ status: 'success', target: 'refused' });
  });

  it('refuses to compile when nothing in the document collects an applicant attribute it needs', () => {
    expect(() =>
      compileWorkflow({
        id: 'kyc',
        version: 1,
        steps: [
          {
            name: 'check',
            type: 'kyc-identity-verification',
            config: {
              connector: { id: 'sumsub_kyc' },
              levelName: 'level',
              sourceKey: 'source',
              questionnaireDefinitionId: 'questions',
              maxAttemptsPerDocSet: 3,
            },
            edges: {
              verified: 'done',
              review: 'done',
              'retry.IDENTITY': 'done',
              'retry.SELFIE': 'done',
              'retry.APPLICANT_DATA': 'done',
              'retry.QUESTIONNAIRE': 'done',
              refused: 'done',
            },
          },
          terminal('done'),
        ],
      }),
    ).toThrow('WORKFLOW_INVALID');
  });
});

describe('kyc-identity-verification, given additions', () => {
  const graphWith = (
    connector: Record<string, unknown>,
    sumsubKeys: Record<string, unknown> = {
      levelName: 'level',
      questionnaireDefinitionId: 'questions',
    },
  ) => ({
    id: 'kyc',
    version: 1,
    steps: [
      {
        name: 'who',
        type: 'identity-profile',
        config: { nationalities: ['FR'] },
        include: [
          { type: 'contact-details', config: { phoneNumber: 'omitted' } },
          { type: 'address', config: { countries: ['FR'] } },
          { type: 'questionnaire', config: { sections: ['purpose'] } },
        ],
        edges: { success: 'face' },
      },
      { name: 'face', type: 'selfie-capture', edges: { success: 'check' } },
      {
        name: 'check',
        type: 'kyc-identity-verification',
        config: {
          connector,
          ...sumsubKeys,
          sourceKey: 'source',
          maxAttemptsPerDocSet: 3,
        },
        edges: {
          verified: 'done',
          review: 'done',
          'retry.IDENTITY': 'face',
          'retry.SELFIE': 'face',
          'retry.APPLICANT_DATA': 'done',
          'retry.QUESTIONNAIRE': 'who',
          refused: 'refused',
        },
      },
      terminal('done'),
      terminal('refused', 'rejected'),
    ],
  });

  it('lays extra payload keys and adapter config under what it derived', () => {
    const compiled = compileWorkflow(
      graphWith({
        id: 'sumsub_kyc',
        fieldMapping: { email: 'email' },
        config: { lang: 'fr' },
      }),
    );
    const connector = compiled.steps.find((step) => step.name === 'check')!.connectors![0];

    expect(connector.fieldMapping.email).toBe('email');
    expect(connector.fieldMapping.firstName).toBe('firstName');
    expect(connector.config).toMatchObject({ lang: 'fr', levelName: 'level' });
  });

  it('compiles without the Sumsub keys and carries neither in the connector config', () => {
    const compiled = compileWorkflow(graphWith({ id: 'sumsub_kyc' }, {}));
    const connector = compiled.steps.find((step) => step.name === 'check')!.connectors![0];

    expect(connector.config).not.toHaveProperty('levelName');
    expect(connector.config).not.toHaveProperty('questionnaireDefinitionId');
  });

  it('takes levelName from connector.config when the step omits it', () => {
    const compiled = compileWorkflow(
      graphWith({ id: 'sumsub_kyc', config: { levelName: 'from-binding' } }, {}),
    );
    const connector = compiled.steps.find((step) => step.name === 'check')!.connectors![0];

    expect(connector.config).toMatchObject({ levelName: 'from-binding' });
  });

  it('refuses an addition that would override a derived key', () => {
    expect(() =>
      compileWorkflow(graphWith({ id: 'sumsub_kyc', fieldMapping: { firstName: 'nickname' } })),
    ).toThrow('WORKFLOW_INVALID');
    expect(() =>
      compileWorkflow(graphWith({ id: 'sumsub_kyc', config: { levelName: 'other' } })),
    ).toThrow('WORKFLOW_INVALID');
  });
});

describe('kyc-identity-verification, given a choice nobody captures', () => {
  it('refuses a document the applicant could pick and then have nowhere to upload', () => {
    expect(() =>
      compileWorkflow({
        id: 'kyc',
        version: 1,
        steps: [
          {
            name: 'who',
            type: 'identity-profile',
            config: { nationalities: ['FR'] },
            include: [
              { type: 'address', config: { countries: ['FR'] } },
              { type: 'questionnaire', config: { sections: ['purpose'] } },
            ],
            edges: { success: 'pick' },
          },
          {
            name: 'pick',
            type: 'document-choice',
            config: {
              documents: [
                { type: 'PASSPORT', countries: ['FR'] },
                // Offered, but no `document-capture` step collects it.
                { type: 'ID_CARD', countries: ['FR'] },
              ],
            },
            edges: { PASSPORT: 'passport', ID_CARD: 'face' },
          },
          {
            name: 'passport',
            type: 'document-capture',
            config: { document: 'PASSPORT' },
            edges: { success: 'face' },
          },
          { name: 'face', type: 'selfie-capture', edges: { success: 'check' } },
          {
            name: 'check',
            type: 'kyc-identity-verification',
            config: {
              connector: { id: 'sumsub_kyc' },
              levelName: 'level',
              sourceKey: 'source',
              questionnaireDefinitionId: 'questions',
              maxAttemptsPerDocSet: 3,
            },
            edges: {
              verified: 'done',
              review: 'done',
              'retry.IDENTITY': 'pick',
              'retry.SELFIE': 'face',
              'retry.APPLICANT_DATA': 'done',
              'retry.QUESTIONNAIRE': 'who',
              refused: 'refused',
            },
          },
          terminal('done'),
          terminal('refused', 'rejected'),
        ],
      }),
    ).toThrow('WORKFLOW_INVALID');
  });
});

describe('manual-review', () => {
  it('leaves a stray customer submit where it was instead of destroying the case', () => {
    const [step] = compileStep({
      name: 'review',
      type: 'manual-review',
      edges: { approve: 'done', reject: 'refused', invalid: 'void' },
    });

    expect(step.status).toBe('awaiting_manual_review');
    expect(step.transitions).toEqual([
      { status: 'success' },
      { status: 'manual.approve', target: 'done' },
      { status: 'manual.reject', target: 'refused' },
      { status: 'manual.invalid', target: 'void' },
    ]);
  });
});

describe('http-call', () => {
  it('derives its field mapping from the payload placeholders in the request', () => {
    const [step] = compileStep({
      name: 'provision',
      type: 'http-call',
      config: {
        connector: { name: 'account_provisioning' },
        request: {
          method: 'POST',
          url: 'https://accounts.example.internal/v1/accounts',
          headers: { 'Idempotency-Key': '{{execution.onboardingId}}' },
          body: { firstName: '{{payload.firstName}}', town: '{{payload.town}}' },
        },
      },
      edges: { success: 'done' },
    });

    expect(step.connectors?.[0]).toMatchObject({
      name: 'account_provisioning',
      id: 'http_request',
      type: 'custom',
      // The template is the single source, so a placeholder cannot outlive its mapping.
      fieldMapping: { firstName: 'firstName', town: 'town' },
    });
  });

  it('refuses a mapping for a payload key the template never references', () => {
    expect(() =>
      compileStep({
        name: 'provision',
        type: 'http-call',
        config: {
          request: { url: 'https://example.internal', body: { a: '{{payload.a}}' } },
          fieldMapping: { b: 'somethingElse' },
        },
        edges: { success: 'done' },
      }),
    ).toThrow('WORKFLOW_INVALID');
  });
});

describe('decision and risk-score', () => {
  it('routes a decision on its branches, with no catch-all unless asked for', () => {
    const [step] = compileStep({
      name: 'branch',
      type: 'decision',
      config: {
        branches: [{ port: 'resident', when: { field: 'country', equals: 'FR' } }],
        fallback: true,
      },
      edges: { resident: 'done', default: 'refused' },
      include: [
        {
          type: 'form',
          config: { fields: { country: { type: 'text', required: true } } },
        },
      ],
    });

    expect(step.transitions).toEqual([
      { status: 'success', when: { field: 'country', equals: 'FR' }, target: 'done' },
      { status: 'success', target: 'refused' },
    ]);
  });

  it('turns bands into score conditions, in the order the author declared them', () => {
    const compiled = compileWorkflow({
      id: 'scored',
      version: 1,
      scoring: { risk: { min: 0, max: 100 } },
      steps: [
        {
          name: 'assess',
          type: 'risk-score',
          config: {
            rules: [{ score: 'risk', when: { field: 'flag', isSet: true }, add: 40 }],
            bands: [{ port: 'high', score: 'risk', gte: 40 }],
            fallback: true,
          },
          include: [
            { type: 'form', config: { fields: { flag: { type: 'text', required: true } } } },
          ],
          edges: { high: 'refused', default: 'done' },
        },
        terminal('done'),
        terminal('refused', 'rejected'),
      ],
    });

    expect(compiled.steps[0].scoring).toEqual([
      { score: 'risk', when: { field: 'flag', isSet: true }, add: 40 },
    ]);
    expect(compiled.steps[0].transitions).toEqual([
      { status: 'success', when: { score: 'risk', gte: 40 }, target: 'refused' },
      { status: 'success', target: 'done' },
    ]);
  });
});

describe('custom', () => {
  it('is held to the compiled schema’s own definitions, at the member the author wrote', () => {
    // A connector with no `order`: refused where it was written, before anything compiles, rather
    // than in the coordinates of the compiled document.
    expect(() =>
      validateAndNormalizeWorkflow({
        id: 'smuggle',
        version: 1,
        steps: [
          {
            name: 'bespoke',
            type: 'custom',
            config: {
              connectors: [{ name: 'x', id: 'http_request', type: 'custom', fieldMapping: {} }],
              transitions: [{ status: 'success', target: 'done' }],
            },
          },
          terminal('done'),
        ],
      }),
    ).toThrow(
      expect.objectContaining({ reason: 'INVALID_SHAPE', path: 'steps[0].config.connectors[0]' }),
    );
  });

  it('passes a hand-written step through verbatim, so the compiled form loses no expressiveness', () => {
    const [step] = compileStep({
      name: 'bespoke',
      type: 'custom',
      config: {
        status: 'awaiting_user',
        data: { note: { type: 'text', required: false } },
        transitions: [{ status: 'success', target: 'done', webhook: { notify: false } }],
      },
    });

    expect(step).toEqual({
      name: 'bespoke',
      status: 'awaiting_user',
      data: { note: { type: 'text', required: false } },
      transitions: [{ status: 'success', target: 'done', webhook: { notify: false } }],
    });
  });
});

describe('terminal', () => {
  it('names the outcome and carries nothing else', () => {
    const [step] = compileStep(terminal('finished', 'rejected'));

    expect(step).toEqual({ name: 'finished', status: 'rejected', data: {}, transitions: [] });
  });

  it('refuses an include, which the engine would reject as a non-empty terminal step', () => {
    expect(() =>
      compileStep({
        ...terminal('finished'),
        include: [{ type: 'form', config: { fields: { a: { type: 'text', required: true } } } }],
      }),
    ).toThrow('WORKFLOW_INVALID');
  });
});

describe('connector-call', () => {
  const mockKyc = {
    name: 'mock_kyc_1',
    id: 'mock_kyc_1',
    type: 'kyc',
    order: 1,
    fieldMapping: { email: 'email' },
  };

  it('collects its fields and calls the declared connectors verbatim, following one success edge', () => {
    const [step] = compileStep({
      name: 'collect_email',
      type: 'connector-call',
      config: {
        fields: { email: { type: 'text', required: true, validation: { format: 'email' } } },
        connectors: [mockKyc],
      },
      edges: { success: 'done' },
    });

    expect(step).toEqual({
      name: 'collect_email',
      status: 'awaiting_user',
      data: { email: { type: 'text', required: true, validation: { format: 'email' } } },
      connectors: [mockKyc],
      transitions: [{ status: 'success', target: 'done' }],
    });
  });

  it('exposes a rejected port exactly when a connector can refuse, and the compiled step is held to the refusal rule', () => {
    const rejecting = { ...mockKyc, canReject: true };
    const [step] = compileStep({
      name: 'check',
      type: 'connector-call',
      config: { fields: { email: { type: 'text', required: true } }, connectors: [rejecting] },
      edges: { success: 'done', rejected: 'refused' },
    });

    expect(step.transitions).toEqual([
      { status: 'success', target: 'done' },
      { status: 'rejected', target: 'refused' },
    ]);
    // Without a refusing connector there is no port to wire.
    expect(() =>
      compileStep({
        name: 'check',
        type: 'connector-call',
        config: { fields: { email: { type: 'text', required: true } }, connectors: [mockKyc] },
        edges: { success: 'done', rejected: 'refused' },
      }),
    ).toThrow('WORKFLOW_INVALID');
    // A refusal must land on a rejected terminal, as for a hand-written step.
    expect(() =>
      validateAndNormalizeWorkflow({
        id: 'refusal',
        version: 1,
        steps: [
          {
            name: 'check',
            type: 'connector-call',
            config: {
              fields: { email: { type: 'text', required: true } },
              connectors: [rejecting],
            },
            edges: { success: 'done', rejected: 'done' },
          },
          terminal('done'),
        ],
      }),
    ).toThrow(expect.objectContaining({ reason: 'INVALID_TRANSITIONS' }));
  });

  it('collects nothing of its own when it only calls, and takes fragments and a canonical role like a form', () => {
    const [step] = compileStep({
      name: 'notice',
      type: 'connector-call',
      config: {
        connectors: [{ ...mockKyc, fieldMapping: { email: 'workEmail' } }],
      },
      include: [
        {
          type: 'form',
          config: {
            fields: { workEmail: { type: 'text', required: true } },
            canonical: { email: 'workEmail' },
          },
        },
      ],
      edges: { success: 'done' },
    });

    expect(Object.keys(step.data)).toEqual(['workEmail']);
    expect(() =>
      compileStep({
        name: 'notice',
        type: 'connector-call',
        config: {
          fields: { workEmail: { type: 'text', required: true } },
          canonical: { email: 'personalEmail' },
          connectors: [mockKyc],
        },
        edges: { success: 'done' },
      }),
    ).toThrow('WORKFLOW_INVALID');
  });

  it('refuses to call nothing, and a declaration the compiled schema would refuse', () => {
    expect(() =>
      compileStep({
        name: 'idle',
        type: 'connector-call',
        config: { fields: { a: { type: 'text', required: true } }, connectors: [] },
        edges: { success: 'done' },
      }),
    ).toThrow('WORKFLOW_INVALID');
    expect(() =>
      compileStep({
        name: 'idle',
        type: 'connector-call',
        config: { connectors: [{ name: 'x', id: 'mock_kyc_1', type: 'kyc', fieldMapping: {} }] },
        edges: { success: 'done' },
      }),
    ).toThrow(
      expect.objectContaining({ reason: 'INVALID_SHAPE', path: 'steps[0].config.connectors[0]' }),
    );
  });
});

describe("a connector slot's failure policy", () => {
  it('carries errorHandler, retry and a fallback chain onto the declaration a notify step emits', () => {
    const [step] = compileStep({
      name: 'send_notification',
      type: 'notify',
      config: {
        connector: {
          name: 'primary_email',
          id: 'sendgrid_email',
          errorHandler: 'retry_then_fallback',
          retry: { maxAttempts: 3, delayMs: 200 },
          fieldMapping: {
            templateId: 'emailTemplateId',
            'dynamicTemplateData.first_name': 'firstName',
          },
          fallback: [
            {
              name: 'unavailable_email',
              id: 'mock_email_delivery',
              retry: { maxAttempts: 1 },
              config: { failWithStatus: 503 },
            },
            {
              name: 'backup_email',
              id: 'smtp',
              fieldMapping: { subject: 'subject', firstName: 'firstName' },
              config: { templatePath: 'fixtures/manual-smtp.html' },
            },
          ],
        },
        recipientField: 'email',
      },
      include: [
        {
          type: 'form',
          config: {
            fields: {
              email: { type: 'text', required: true },
              emailTemplateId: { type: 'text', required: true },
              firstName: { type: 'text', required: true },
              subject: { type: 'text', required: true },
            },
          },
        },
      ],
      edges: { success: 'done' },
    });

    expect(step.connectors?.[0]).toEqual({
      name: 'primary_email',
      id: 'sendgrid_email',
      type: 'email_delivery',
      order: 1,
      fieldMapping: {
        recipient: 'email',
        templateId: 'emailTemplateId',
        'dynamicTemplateData.first_name': 'firstName',
      },
      errorHandler: 'retry_then_fallback',
      retry: { maxAttempts: 3, delayMs: 200 },
      fallback: [
        {
          name: 'unavailable_email',
          id: 'mock_email_delivery',
          type: 'email_delivery',
          // No additions of its own, so it inherits the primary's beside the derived recipient.
          fieldMapping: {
            recipient: 'email',
            templateId: 'emailTemplateId',
            'dynamicTemplateData.first_name': 'firstName',
          },
          config: { failWithStatus: 503 },
          retry: { maxAttempts: 1 },
        },
        {
          name: 'backup_email',
          id: 'smtp',
          type: 'email_delivery',
          // Its own additions replace the primary's; the derived recipient stays.
          fieldMapping: { recipient: 'email', subject: 'subject', firstName: 'firstName' },
          config: { templatePath: 'fixtures/manual-smtp.html' },
        },
      ],
    });
  });

  it('gives each OTP fallback its own send and check settings, on every step of the challenge', () => {
    const [send, verify, resend] = compileOtpWith({
      id: 'twilio_verify',
      startConfig: { operation: 'startVerification' },
      checkConfig: { operation: 'checkVerification' },
      fallback: [
        {
          id: 'mock_phone_verification',
          startConfig: { operation: 'challenge' },
          checkConfig: { operation: 'verify' },
        },
      ],
    });

    for (const step of [send, resend]) {
      expect(step.connectors?.[0].fallback).toEqual([
        {
          name: 'mock_phone_verification',
          id: 'mock_phone_verification',
          type: 'phone_verification',
          fieldMapping: { recipient: 'phoneNumber' },
          config: { operation: 'challenge' },
        },
      ]);
    }
    expect(verify.connectors?.[0].fallback).toEqual([
      {
        name: 'mock_phone_verification',
        id: 'mock_phone_verification',
        type: 'phone_verification',
        fieldMapping: { recipient: 'phoneNumber', code: 'verificationCode' },
        config: { operation: 'verify' },
      },
    ]);
  });

  it('refuses a fallback of another capability than the primary', () => {
    expect(() =>
      compileOtpWith({ id: 'twilio_verify', fallback: [{ id: 'sumsub_kyc', type: 'kyc' }] }),
    ).toThrow('WORKFLOW_INVALID');
  });

  it('asks a stand-in identity provider the same question, plus what the entry adds', () => {
    const compiled = compileWorkflow({
      id: 'kyc',
      version: 1,
      steps: [
        {
          name: 'who',
          type: 'identity-profile',
          config: { nationalities: ['FR'] },
          include: [
            { type: 'address', config: { countries: ['FR'] } },
            { type: 'questionnaire', config: { sections: ['purpose'] } },
          ],
          edges: { success: 'face' },
        },
        { name: 'face', type: 'selfie-capture', edges: { success: 'check' } },
        {
          name: 'check',
          type: 'kyc-identity-verification',
          config: {
            connector: {
              id: 'sumsub_kyc',
              fallback: [{ id: 'mock_kyc_1', config: { lang: 'fr' } }],
            },
            levelName: 'level',
            sourceKey: 'source',
            questionnaireDefinitionId: 'questions',
            maxAttemptsPerDocSet: 3,
          },
          edges: {
            verified: 'done',
            review: 'done',
            'retry.IDENTITY': 'face',
            'retry.SELFIE': 'face',
            'retry.APPLICANT_DATA': 'done',
            'retry.QUESTIONNAIRE': 'who',
            refused: 'refused',
          },
        },
        terminal('done'),
        terminal('refused', 'rejected'),
      ],
    });
    const connector = compiled.steps.find((step) => step.name === 'check')!.connectors![0];
    const [fallback] = connector.fallback!;

    expect(fallback.fieldMapping).toEqual(connector.fieldMapping);
    expect(fallback.optionalFieldMapping).toEqual(connector.optionalFieldMapping);
    expect(fallback.config).toEqual({ ...connector.config, lang: 'fr' });
  });

  it('makes every stand-in of an http-call the same request', () => {
    const [step] = compileStep({
      name: 'provision',
      type: 'http-call',
      config: {
        connector: { fallback: [{ id: 'other_http', name: 'other' }] },
        request: { url: 'https://accounts.example.internal', body: { a: '{{payload.a}}' } },
      },
      edges: { success: 'done' },
    });
    const [connector] = step.connectors!;

    expect(connector.fallback).toEqual([
      {
        name: 'other',
        id: 'other_http',
        type: 'custom',
        fieldMapping: { a: 'a' },
        config: connector.config,
      },
    ]);
  });
});

describe('manual-review, given no invalid edge', () => {
  it('compiles without the arm, so an operator marking the case invalid is refused rather than routed', () => {
    const [step] = compileStep({
      name: 'review',
      type: 'manual-review',
      edges: { approve: 'done', reject: 'refused' },
    });

    expect(step.transitions).toEqual([
      { status: 'success' },
      { status: 'manual.approve', target: 'done' },
      { status: 'manual.reject', target: 'refused' },
    ]);
  });
});
