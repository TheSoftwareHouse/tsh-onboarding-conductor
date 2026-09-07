import { compileNodeGraph } from './node-graph.compiler';
import type { RawWorkflowNode } from './node-graph.contract';
import { validateAndNormalizeWorkflow } from '../workflow-validator';
import { EEA_ID_CARD_ISSUERS, EEA_MEMBER_STATES } from './presets/country.preset';
import type { RawWorkflowField, RawWorkflowStep } from '../workflow-contract';

/**
 * Reads a type-specific member off a field descriptor. The envelope type declares only what every
 * type shares, so `validation` lives on the field-type module that owns it and has to be read out.
 */
const validationOf = (field: RawWorkflowField): Record<string, unknown> =>
  (field as { validation?: Record<string, unknown> }).validation ?? {};

const terminal = (name: string, outcome = 'approved'): RawWorkflowNode => ({
  name,
  type: 'terminal',
  config: { outcome },
});

/**
 * Compiles a one-node graph and returns the steps that node produced. The three terminals and any
 * `extra` node compile to one step each, named after the node, so those are what gets dropped.
 */
const compileNode = (
  node: RawWorkflowNode,
  extra: readonly RawWorkflowNode[] = [],
): RawWorkflowStep[] => {
  const scaffolding = [
    terminal('done'),
    terminal('refused', 'rejected'),
    terminal('void', 'invalid'),
    ...extra,
  ];
  const scaffoldingNames = new Set(scaffolding.map((candidate) => candidate.name));
  const compiled = compileNodeGraph({
    id: 'single',
    version: 1,
    name: 'Single',
    nodes: [node, ...scaffolding],
  });

  return compiled.steps.filter((step) => !scaffoldingNames.has(step.name));
};

describe('consents', () => {
  it('pins each version as the only accepted value and names the acknowledgement after its verb', () => {
    const [step] = compileNode({
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
    const [step] = compileNode({
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
    const [step] = compileNode({
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
    const [step] = compileNode(
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
    const [step] = compileNode({
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
    const steps = compileNode({
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
    const [document] = compileNode({
      name: 'passport',
      type: 'document-capture',
      config: { document: 'PASSPORT' },
      edges: { success: 'done' },
    });
    const [selfie] = compileNode({
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

describe('otp-verify', () => {
  const compileOtp = (): RawWorkflowStep[] =>
    compileNode({
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
    });

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

  it('never persists the code, and collects the recipient it will challenge', () => {
    const [send, verify] = compileOtp();

    expect(send.data.phoneNumber).toEqual({
      type: 'text',
      required: true,
      validation: { format: 'phone' },
    });
    expect(verify.data.verificationCode.persist).toBe(false);
  });
});

describe('kyc-identity-verification', () => {
  const compiled = compileNodeGraph({
    id: 'kyc',
    version: 1,
    name: 'Kyc',
    nodes: [
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

  it('builds its document table from the capture and choice nodes, joined on document type', () => {
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
    ]);
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
      compileNodeGraph({
        id: 'kyc',
        version: 1,
        name: 'Kyc',
        nodes: [
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

describe('kyc-identity-verification, given a choice nobody captures', () => {
  it('refuses a document the applicant could pick and then have nowhere to upload', () => {
    expect(() =>
      compileNodeGraph({
        id: 'kyc',
        version: 1,
        name: 'Kyc',
        nodes: [
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
                // Offered, but no `document-capture` node collects it.
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
    const [step] = compileNode({
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
    const [step] = compileNode({
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
      compileNode({
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
    const [step] = compileNode({
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
    const compiled = compileNodeGraph({
      id: 'scored',
      version: 1,
      name: 'Scored',
      scoring: { risk: { min: 0, max: 100 } },
      nodes: [
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

describe('custom-step', () => {
  it('cannot smuggle a malformed step past the step schema the compiled document still meets', () => {
    // The node schema only checks that `connectors` holds objects; the compiled document is then
    // validated as a hand-written one, and that is where a connector with no `order` is refused.
    expect(() =>
      validateAndNormalizeWorkflow({
        id: 'smuggle',
        version: 1,
        name: 'Smuggle',
        nodes: [
          {
            name: 'bespoke',
            type: 'custom-step',
            config: {
              connectors: [{ name: 'x', id: 'http_request', type: 'custom', fieldMapping: {} }],
              transitions: [{ status: 'success', target: 'done' }],
            },
          },
          terminal('done'),
        ],
      }),
    ).toThrow('WORKFLOW_INVALID');
  });

  it('passes a hand-written step through verbatim, so the node form loses no expressiveness', () => {
    const [step] = compileNode({
      name: 'bespoke',
      type: 'custom-step',
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
    const [step] = compileNode(terminal('finished', 'rejected'));

    expect(step).toEqual({ name: 'finished', status: 'rejected', data: {}, transitions: [] });
  });

  it('refuses an include, which the engine would reject as a non-empty terminal step', () => {
    expect(() =>
      compileNode({
        ...terminal('finished'),
        include: [{ type: 'form', config: { fields: { a: { type: 'text', required: true } } } }],
      }),
    ).toThrow('WORKFLOW_INVALID');
  });
});
