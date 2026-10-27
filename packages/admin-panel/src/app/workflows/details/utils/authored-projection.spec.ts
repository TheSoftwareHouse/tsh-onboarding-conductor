import { describe, expect, it } from 'vitest';
import { listStepTypes, STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { TERMINAL_WORKFLOW_STATUSES } from '@tsh/ddl-schema/workflow-contract';
import { UNWIRED, type AuthoredDocument, type AuthoredStep } from './authored-document';
import {
  acceptsScoring,
  listBackEdges,
  listComposableTypes,
  listIncludableTypes,
  listSections,
  projectDocument,
  resolvePorts,
  type ProjectedStep,
} from './authored-projection';

const form = (name: string, edges?: AuthoredStep['edges']): AuthoredStep => ({
  name,
  type: STEP_TYPE.form,
  config: { fields: { [`${name}Field`]: { type: 'text', required: true } } },
  ...(edges ? { edges } : {}),
});

const terminal = (name: string, outcome = 'approved'): AuthoredStep => ({
  name,
  type: STEP_TYPE.terminal,
  config: { outcome },
});

function project(...steps: AuthoredStep[]): ReturnType<typeof projectDocument> {
  return projectDocument({ steps });
}

function findProjected(steps: ProjectedStep[], name: string): ProjectedStep {
  const found = steps.find((projected) => projected.step.name === name);
  if (found === undefined) throw new Error(`no step ${name}`);
  return found;
}

describe('resolvePorts', () => {
  it('lists the ports a step type derives from its config', () => {
    const ports = resolvePorts(form('a'));

    expect(ports).toEqual({ kind: 'known', ports: [{ name: 'success' }] });
  });

  it('reports an unknown type', () => {
    expect(resolvePorts({ name: 'a', type: 'nope' })).toEqual({ kind: 'unknown-type' });
  });

  it('reports a config the type refuses', () => {
    const ports = resolvePorts({ name: 'a', type: STEP_TYPE.form, config: { fields: 'no' } });

    expect(ports.kind).toBe('config-error');
  });

  it('turns a custom step transitions into labelled ports', () => {
    const custom: AuthoredStep = {
      name: 'c',
      type: STEP_TYPE.custom,
      config: {
        transitions: [
          { status: 'success', target: 'x', when: { field: 'a', isSet: true } },
          { status: 'success', target: 'y' },
          { status: 'manual.approve' },
        ],
      },
    };

    const ports = resolvePorts(custom);

    expect(ports.kind === 'known' && ports.ports).toEqual([
      { name: 'transition-0', optional: false, label: 'success 1', detail: 'when a is set' },
      { name: 'transition-1', optional: false, label: 'success else', detail: '' },
      { name: 'transition-2', optional: true, label: 'approve', detail: '' },
    ]);
  });
});

describe('projectDocument edges', () => {
  it('projects a plain edge as one unconditional edge', () => {
    const { edges } = project(form('a', { success: 'b' }), terminal('b'));

    expect(edges).toEqual([
      {
        id: 'a:success:0',
        source: 'a',
        port: 'success',
        armIndex: null,
        handle: 'success',
        target: 'b',
        label: 'success',
        condition: '',
        dangling: false,
      },
    ]);
  });

  it('gives each arm of a branched port its own handle and label', () => {
    const when = { field: 'x', equals: 1 };
    const { edges } = project(
      form('a', { success: [{ when, target: 'b' }, { target: 'c' }] }),
      terminal('b'),
      terminal('c'),
    );

    expect(edges.map((edge) => [edge.handle, edge.armIndex, edge.label])).toEqual([
      ['success#0', 0, 'success · when x = 1'],
      ['success#1', 1, 'success'],
    ]);
  });

  it('marks an edge to a missing step as dangling', () => {
    const { edges, steps } = project(form('a', { success: 'ghost' }));

    expect(edges[0]?.dangling).toBe(true);
    expect(steps[0]?.issues).toContain('points to missing ghost');
  });

  it('keeps an unwired arm out of the edges and reports it as unfinished', () => {
    const { edges, steps } = project(form('a', { success: [{ target: UNWIRED }] }));

    expect(edges).toEqual([]);
    expect(steps[0]?.unfinished).toEqual(['success']);
    expect(steps[0]?.issues).toContain('no target: success');
  });

  it('draws a custom transition to a sub-step as an edge to its authored step', () => {
    const phone: AuthoredStep = {
      name: 'phone',
      type: STEP_TYPE.otpVerify,
      config: { channel: 'sms', connector: { id: 'otp' } },
    };
    const custom: AuthoredStep = {
      name: 'c',
      type: STEP_TYPE.custom,
      config: {
        transitions: [
          { status: 'success', target: 'phone_verify' },
          { status: 'rejected', target: UNWIRED },
        ],
      },
    };

    const { edges, steps } = project(custom, phone);

    expect(edges.map((edge) => [edge.id, edge.target, edge.dangling])).toEqual([
      ['c:transition-0:0', 'phone', false],
    ]);
    expect(findProjected(steps, 'c').unfinished).toEqual(['transition-1']);
  });
});

describe('projectDocument ports and problems', () => {
  it('lists required ports with nothing wired', () => {
    const { steps } = project(form('a'));

    expect(steps[0]?.unwired).toEqual(['success']);
    expect(steps[0]?.issues).toContain('unwired: success');
  });

  it('lists edge keys the step type does not have', () => {
    const { steps } = project(form('a', { success: 'b', nowhere: 'b' }), terminal('b'));

    expect(steps[0]?.strayPorts).toEqual(['nowhere']);
    expect(steps[0]?.issues).toContain('no such port: nowhere');
  });

  it('reports an unknown type and a bad config', () => {
    const { steps } = project(
      { name: 'a', type: 'nope' },
      { name: 'b', type: STEP_TYPE.form, config: { fields: 'no' } },
    );

    expect(steps[0]?.issues).toContain('unknown type nope');
    expect(steps[1]?.issues.some((issue) => issue.startsWith('invalid config:'))).toBe(true);
  });

  it('names the failing setting in a bad config', () => {
    const { steps } = project({
      name: 'a',
      type: STEP_TYPE.otpVerify,
      config: { channel: 'pigeon', connector: { id: 'twilio_sms_otp' } },
    });

    expect(steps[0]?.issues).toContain('invalid config: channel (Not one of the allowed values)');
  });

  it('keeps the bare code for a config only parseConfig rejects', () => {
    const { steps } = project({
      name: 'a',
      type: STEP_TYPE.httpCall,
      config: { request: { method: 'POST', url: 'https://x.test/{{missing}}' }, fieldMapping: {} },
    });

    expect(steps[0]?.issues.some((issue) => /^invalid config: [A-Z_]+$/.test(issue))).toBe(true);
  });

  it('reports an initial terminal step', () => {
    const { steps } = project(terminal('a'));

    expect(steps[0]?.issues).toContain('initial step cannot be terminal');
  });

  it('reports an invalid included section', () => {
    const step: AuthoredStep = {
      ...form('a', { success: 'b' }),
      include: [{ type: STEP_TYPE.address, config: { countries: 5 } }],
    };

    const { steps } = project(step, terminal('b'));

    expect(steps[0]?.issues.some((issue) => issue.startsWith('invalid address section:'))).toBe(
      true,
    );
  });

  it('attaches the category of a known type and none to an unknown one', () => {
    const { steps } = project(form('a'), { name: 'b', type: 'nope' });

    expect(steps.map((projected) => projected.category)).toEqual(['collect', null]);
  });
});

describe('projectDocument connector mappings', () => {
  const collect = (config: AuthoredStep['config']): AuthoredStep => ({
    name: 'collect',
    type: STEP_TYPE.form,
    config,
    edges: { success: 'http' },
  });
  const http = (fieldMapping?: Record<string, string>): AuthoredStep => ({
    name: 'http',
    type: STEP_TYPE.httpCall,
    config: {
      request: { method: 'POST', url: 'https://x', body: { a: '{{payload.email}}' } },
      ...(fieldMapping === undefined ? {} : { fieldMapping }),
    },
  });
  const issuesOf = (steps: AuthoredStep[]): string[] =>
    projectDocument({ steps }).steps.find((step) => step.step.name === 'http')?.issues ?? [];

  it('reports a placeholder or mapping that reads a field no step stores', () => {
    expect(issuesOf([collect({ fields: { phone: { type: 'text' } } }), http()])).toContain(
      'payload email reads missing field email',
    );
    expect(
      issuesOf([collect({ fields: { phone: { type: 'text' } } }), http({ email: 'workEmail' })]),
    ).toContain('payload email reads missing field workEmail');
  });

  it('is quiet when the field is stored, or declared by a step that does not compile', () => {
    expect(
      issuesOf([
        collect({ fields: { workEmail: { type: 'text' } } }),
        http({ email: 'workEmail' }),
      ]),
    ).not.toContainEqual(expect.stringContaining('reads missing field'));
    expect(issuesOf([collect({ fields: { email: { type: 'nope' } } }), http()])).not.toContainEqual(
      expect.stringContaining('reads missing field'),
    );
  });
});

describe('projectDocument workflow issues', () => {
  const steps: AuthoredDocument['steps'] = [
    { name: 'done', type: STEP_TYPE.terminal, config: { outcome: 'approved' } },
  ];

  it('names a missing initial step and agreements on missing steps', () => {
    expect(
      projectDocument({
        initial: 'start',
        steps,
        agreements: [
          { key: 'terms', step: 'gone', acceptedWhen: 'accepted' },
          { key: 'kept', step: 'done', acceptedWhen: 'accepted' },
        ],
      }).workflowIssues,
    ).toEqual(['initial step points to missing start', 'agreement terms points to missing gone']);
  });

  it('is empty when everything the workflow names exists', () => {
    expect(projectDocument({ initial: 'done', steps }).workflowIssues).toEqual([]);
  });
});

describe('projectDocument reachability', () => {
  const doc = (initial?: string): AuthoredDocument => ({
    ...(initial ? { initial } : {}),
    steps: [form('a', { success: 'b' }), terminal('b'), terminal('orphan')],
  });

  it('starts from the first step when `initial` is absent', () => {
    const { steps } = projectDocument(doc());

    expect(steps.map((projected) => projected.isInitial)).toEqual([true, false, false]);
    expect(findProjected(steps, 'orphan').issues).toContain('unreachable from the initial step');
    expect(findProjected(steps, 'b').issues).not.toContain('unreachable from the initial step');
  });

  it('starts from the named initial step', () => {
    const { steps } = projectDocument(doc('b'));

    expect(findProjected(steps, 'a').issues).toContain('unreachable from the initial step');
  });
});

describe('projectDocument summaries', () => {
  const summarize = (step: AuthoredStep): string | undefined => project(step).steps[0]?.summary;

  it('shows a terminal outcome', () => {
    expect(summarize(terminal('t', 'rejected'))).toBe('terminal · rejected');
  });

  it.each(TERMINAL_WORKFLOW_STATUSES)('shows a custom step ending in %s as terminal', (status) => {
    const custom: AuthoredStep = {
      name: 'c',
      type: STEP_TYPE.custom,
      config: { status, transitions: [] },
    };

    expect(summarize(custom)).toBe(`terminal · ${status}`);
  });

  it('shows only the connector id, whatever the connector does', () => {
    const kyc: AuthoredStep = {
      name: 'k',
      type: STEP_TYPE.kycIdentityVerification,
      config: { connector: { id: 'sumsub_kyc' }, sourceKey: 's', maxAttemptsPerDocSet: 3 },
    };
    const otp: AuthoredStep = {
      name: 'o',
      type: STEP_TYPE.otpVerify,
      config: { channel: 'sms', connector: { id: 'twilio' } },
    };

    expect(summarize(kyc)).toBe('sumsub_kyc');
    expect(summarize(otp)).toBe('twilio');
  });

  it('reads the connector from `connector.name` or the first of `connectors`', () => {
    const named: AuthoredStep = { name: 'a', type: 'x', config: { connector: { name: 'mail' } } };
    const listed: AuthoredStep = {
      name: 'b',
      type: STEP_TYPE.connectorCall,
      config: { connectors: [{ id: 'first' }, { id: 'second' }] },
    };

    expect(summarize(named)).toBe('mail');
    expect(summarize(listed)).toBe('first');
  });

  it('shows the status and the field count of a step without a connector', () => {
    expect(summarize(form('a'))).toBe('awaiting_user · 1 field');
    expect(
      summarize({
        name: 'b',
        type: STEP_TYPE.form,
        config: { fields: { x: { type: 'text' }, y: { type: 'text' } } },
      }),
    ).toBe('awaiting_user · 2 fields');
  });

  it('shows the bare status when the step has no fields', () => {
    const manual: AuthoredStep = { name: 'm', type: STEP_TYPE.manualReview };
    const custom: AuthoredStep = {
      name: 'c',
      type: STEP_TYPE.custom,
      config: { status: 'awaiting_manual_review', transitions: [] },
    };

    expect(summarize(manual)).toBe('awaiting_manual_review');
    expect(summarize(custom)).toBe('awaiting_manual_review');
  });

  it('shows the bare status when the fields cannot be built', () => {
    expect(summarize({ name: 'a', type: STEP_TYPE.form, config: { fields: 'no' } })).toBe(
      'awaiting_user',
    );
  });
});

describe('projectDocument stored and duplicate fields', () => {
  it('lists the fields a step stores, sub-steps included', () => {
    const contact: AuthoredStep = {
      name: 'contact',
      type: STEP_TYPE.contactDetails,
      config: { email: 'omitted' },
      edges: { success: 'phone' },
    };
    const phone: AuthoredStep = {
      name: 'phone',
      type: STEP_TYPE.otpVerify,
      config: { channel: 'sms', connector: { id: 'otp' } },
    };

    const { steps } = project(contact, phone);

    expect(findProjected(steps, 'phone').storedFields?.map((field) => field.name)).toContain(
      'verificationCode',
    );
  });

  it('leaves the stored fields null for a step that does not compile', () => {
    const { steps } = project(form('a'), { name: 'b', type: 'nope' });

    expect(steps[0]?.storedFields).toEqual([{ name: 'aField', type: 'text', required: true }]);
    expect(steps[1]?.storedFields).toBeNull();
  });

  it('names the other owner of a field two steps both create', () => {
    const twin: AuthoredStep = { ...form('b'), config: form('a').config };

    const { steps } = project(form('a', { success: 'b' }), twin);

    expect(steps[0]?.duplicateFields).toEqual(new Map([['aField', ['b']]]));
    expect(steps[1]?.duplicateFields).toEqual(new Map([['aField', ['a']]]));
    expect(steps[0]?.issues).toContain('field aField is also created by b');
  });

  describe('a step reached through a custom transition', () => {
    const kycDocument = (selfieTarget: string): AuthoredDocument => ({
      initial: 'contact',
      steps: [
        {
          name: 'contact',
          type: STEP_TYPE.contactDetails,
          config: { email: 'required', phoneNumber: 'required' },
          edges: { success: 'personal' },
        },
        {
          name: 'personal',
          type: STEP_TYPE.identityProfile,
          config: {
            nationalities: 'eea',
            middleNames: 'optional',
            minAgeYears: 18,
            maxAgeYears: 120,
          },
          include: [{ type: STEP_TYPE.address, config: { countries: 'eea' } }],
          edges: { success: 'purpose' },
        },
        {
          name: 'purpose',
          type: STEP_TYPE.questionnaire,
          config: { sections: ['purpose', 'employment', 'funds', 'declarations'] },
          edges: { success: 'passport' },
        },
        {
          name: 'passport',
          type: STEP_TYPE.documentCapture,
          config: { document: 'PASSPORT' },
          edges: { success: 'selfie' },
        },
        { name: 'selfie', type: STEP_TYPE.selfieCapture, edges: { success: selfieTarget } },
        {
          name: 'hop',
          type: STEP_TYPE.custom,
          config: { status: 'awaiting_user', transitions: [{ status: 'success', target: 'kyc' }] },
        },
        {
          name: 'kyc',
          type: STEP_TYPE.kycIdentityVerification,
          config: {
            connector: { id: 'sumsub_kyc' },
            levelName: 'individual-standard-v2',
            sourceKey: 'kyc_v1',
            questionnaireDefinitionId: 'purpose_profile_v2',
            maxAttemptsPerDocSet: 3,
          },
          edges: {
            verified: 'done',
            review: 'done',
            'retry.IDENTITY': 'passport',
            'retry.SELFIE': 'selfie',
            'retry.APPLICANT_DATA': 'done',
            'retry.QUESTIONNAIRE': 'purpose',
            refused: 'done',
          },
        },
        terminal('done'),
      ],
    });

    it('compiles the step against what earlier steps publish when an edge leads to it', () => {
      const { steps } = projectDocument(kycDocument('kyc'));

      expect(findProjected(steps, 'kyc').issues).toEqual([]);
      expect(findProjected(steps, 'kyc').storedFields).not.toBeNull();
    });

    // The compiler takes a step's ancestors from edges only, so a transition hides what came before.
    it('does not let the transition feed the step what the steps before it publish', () => {
      const { steps } = projectDocument(kycDocument('hop'));

      expect(findProjected(steps, 'kyc').storedFields).toBeNull();
    });
  });

  it('keeps a step that does not compile out of the duplicates', () => {
    const { steps } = project(form('a'), { name: 'b', type: STEP_TYPE.form, config: { x: 1 } });

    expect(steps[0]?.duplicateFields.size).toBe(0);
  });
});

describe('listBackEdges', () => {
  it('finds the edge that retries a step already on the path', () => {
    const { steps, edges } = project(
      form('a', { success: 'b' }),
      form('b', {
        success: [{ when: { field: 'x', isSet: false }, target: 'a' }, { target: 'c' }],
      }),
      terminal('c'),
    );

    expect(listBackEdges(steps, edges)).toEqual(new Set(['b:success:0']));
  });

  it('finds nothing in a straight flow', () => {
    const { steps, edges } = project(form('a', { success: 'b' }), terminal('b'));

    expect(listBackEdges(steps, edges).size).toBe(0);
  });

  it('walks a step the initial one cannot reach', () => {
    const { steps, edges } = project(
      terminal('end'),
      form('x', { success: 'y' }),
      form('y', { success: 'x' }),
    );

    expect(listBackEdges(steps, edges)).toEqual(new Set(['y:success:0']));
  });

  it('ignores a dangling edge', () => {
    const { steps, edges } = project(form('a', { success: 'ghost' }));

    expect(listBackEdges(steps, edges).size).toBe(0);
  });
});

describe('listSections', () => {
  it('lists the step type first, then each include, with the fields each builds', () => {
    const step: AuthoredStep = {
      ...form('a'),
      include: [{ type: STEP_TYPE.contactDetails, config: { email: 'required' } }],
    };

    const sections = listSections(step);

    expect(sections.map((section) => [section.type, section.include])).toEqual([
      ['form', null],
      ['contact-details', 0],
    ]);
    expect(sections[0]?.fields).toEqual([{ name: 'aField', type: 'text', required: true }]);
    expect(Array.isArray(sections[1]?.fields) && sections[1]?.fields.length).toBeGreaterThan(0);
  });

  it('reads a custom step fields from `config.data`', () => {
    const custom: AuthoredStep = {
      name: 'c',
      type: STEP_TYPE.custom,
      config: { data: { code: { type: 'text', required: true }, note: { type: 'text' } } },
    };

    expect(listSections(custom)[0]?.fields).toEqual([
      { name: 'code', type: 'text', required: true },
      { name: 'note', type: 'text', required: false },
    ]);
  });

  it('reports the failure of a section that does not build', () => {
    const [bad, unknown] = listSections({
      name: 'a',
      type: STEP_TYPE.form,
      config: { fields: 'no' },
      include: [{ type: 'nope' }],
    });

    expect(bad?.fields).toEqual({ error: expect.any(String) });
    expect(unknown?.fields).toEqual({ error: 'Unknown type nope' });
  });

  it('defaults a missing config to an empty one', () => {
    expect(listSections({ name: 'a', type: STEP_TYPE.manualReview })[0]?.config).toEqual({});
  });
});

describe('listComposableTypes', () => {
  it('lists the registry types flagged composable', () => {
    const expected = listStepTypes()
      .filter((definition) => definition.composable === true)
      .map((definition) => definition.type);

    expect(listComposableTypes()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected).not.toContain(STEP_TYPE.terminal);
  });
});

describe('listIncludableTypes', () => {
  it('leaves out the step type and every type already included', () => {
    const includable = listIncludableTypes({
      name: 'collect',
      type: STEP_TYPE.form,
      include: [{ type: STEP_TYPE.consents }],
    });

    expect(includable).not.toContain(STEP_TYPE.form);
    expect(includable).not.toContain(STEP_TYPE.consents);
    expect(includable).toEqual(
      listComposableTypes().filter(
        (type) => type !== STEP_TYPE.form && type !== STEP_TYPE.consents,
      ),
    );
  });
});

describe('acceptsScoring', () => {
  it('is false for the two types that take no rules and for unknown ones', () => {
    const rejected = listStepTypes()
      .map((definition) => definition.type)
      .filter((type) => !acceptsScoring(type));

    expect(rejected.sort()).toEqual([STEP_TYPE.riskScore, STEP_TYPE.terminal].sort());
    expect(acceptsScoring('nope')).toBe(false);
  });
});

describe('projectDocument scoring problems', () => {
  const rules = [
    { score: 'risk', add: 1 },
    { score: 'gone', add: 2 },
    { score: 'gone', add: 3 },
  ];

  it('names a score the workflow no longer declares, once', () => {
    const { steps } = projectDocument({
      scoring: { risk: { min: 0, max: 10 } },
      steps: [{ ...form('a'), scoring: rules }],
    });

    expect(steps[0]?.issues).toContain('scoring names undeclared score: gone');
  });

  it('names every rule when the workflow declares no scores', () => {
    const { steps } = projectDocument({ steps: [{ ...form('a'), scoring: rules }] });

    expect(steps[0]?.issues).toContain('scoring names undeclared score: risk, gone');
  });

  it('covers a custom step’s config.scoring too', () => {
    const { steps } = projectDocument({
      scoring: { risk: { min: 0, max: 10 } },
      steps: [
        {
          name: 'a',
          type: STEP_TYPE.custom,
          config: { scoring: [{ score: 'gone', add: 1 }], transitions: [] },
        },
      ],
    });

    expect(steps[0]?.issues).toContain('scoring names undeclared score: gone');
  });

  it('reports nothing when every rule names a declared score', () => {
    const { steps } = projectDocument({
      scoring: { risk: { min: 0, max: 10 } },
      steps: [{ ...form('a'), scoring: [{ score: 'risk', add: 1 }] }],
    });

    expect(steps[0]?.issues.some((issue) => issue.startsWith('scoring'))).toBe(false);
  });
});

describe('projectDocument agreements', () => {
  const custom = (data: Record<string, unknown>): AuthoredStep => ({
    name: 'agree',
    type: STEP_TYPE.custom,
    config: { status: 'awaiting_user', data, transitions: [{ target: 'done' }] },
  });

  it('lists the entry step’s stored yes/no fields as agreement fields', () => {
    const { steps } = project(
      custom({
        termsAccepted: { type: 'boolean', required: true },
        marketing: { type: 'boolean', required: false, persist: false },
        email: { type: 'text', required: true },
      }),
      terminal('done'),
    );

    expect(steps[0]?.agreementFields).toEqual(['termsAccepted']);
  });

  it('lists a consents step’s acknowledgements', () => {
    const { steps } = project(
      {
        name: 'agree',
        type: STEP_TYPE.consents,
        config: { consents: [{ key: 'terms', version: '1', acknowledgement: 'accepted' }] },
        edges: { success: 'done' },
      },
      terminal('done'),
    );

    expect(steps[0]?.agreementFields).toEqual(['termsAccepted']);
  });

  const contact: AuthoredStep = {
    name: 'contact',
    type: STEP_TYPE.contactDetails,
    config: { email: 'required' },
    include: [
      {
        type: STEP_TYPE.consents,
        config: { consents: [{ key: 'terms', acknowledgement: 'accepted' }] },
      },
      { type: STEP_TYPE.questionnaire, config: { sections: ['declarations'] } },
    ],
    edges: { success: 'done' },
  };

  it('offers only an included consents section’s yes/no fields on a typed step', () => {
    const { steps } = project(contact, terminal('done'));

    expect(steps[0]?.agreementFields).toEqual(['termsAccepted']);
  });

  it('keeps a stored yes/no field outside a consents section once an agreement names it', () => {
    const { steps } = projectDocument({
      agreements: [{ key: 'pep', step: 'contact', acceptedWhen: 'pepSelfDeclared' }],
      steps: [contact, terminal('done')],
    });

    expect(steps[0]?.agreementFields).toEqual(['termsAccepted', 'pepSelfDeclared']);
    expect(steps[0]?.issues).toEqual([]);
  });

  it('names an agreement whose field is not a stored yes/no field, or is empty', () => {
    const { steps } = projectDocument({
      agreements: [
        { key: 'terms', step: 'agree', acceptedWhen: 'termsAccepted' },
        { key: 'mail', step: 'agree', acceptedWhen: 'email' },
        { key: 'blank', step: 'agree', acceptedWhen: '' },
      ],
      steps: [
        custom({
          termsAccepted: { type: 'boolean', required: true },
          email: { type: 'text', required: true },
        }),
        terminal('done'),
      ],
    });

    expect(steps[0]?.issues).toEqual([
      'agreement mail: email is not a stored yes/no field',
      'agreement blank names no field',
    ]);
  });
});
