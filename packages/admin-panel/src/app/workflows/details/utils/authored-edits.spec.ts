import { describe, expect, it } from 'vitest';
import { listStepTypes, STEP_TYPE, tryResolveStep } from '@tsh/ddl-schema/step-types';
import {
  addInclude,
  addStep,
  connect,
  deleteStep,
  disconnect,
  findRenameProblem,
  GRID_SIZE,
  hasPositions,
  pinPositions,
  removeInclude,
  renameField,
  renameStep,
  setArms,
  setConfig,
  setInitial,
  setConfigScoringRules,
  setPositions,
  setAgreements,
  setRootKeys,
  setScoringRules,
  setSectionConfig,
  snapToGrid,
} from './authored-edits';
import {
  listCompiledNames,
  readArms,
  toArmHandle,
  toTransitionPort,
  UNWIRED,
  type AuthoredDocument,
} from './authored-document';
import { projectDocument } from './authored-projection';

const when = { field: 'x', isSet: true };

/** An otp step, which compiles to sub-steps a `custom` transition can target by name. */
const OTP_STEP: AuthoredDocument['steps'][number] = {
  name: 'otp',
  type: STEP_TYPE.otpVerify,
  config: {
    channel: 'sms',
    connector: {
      id: 'twilio_sms_otp',
      startConfig: { operation: 'startVerification' },
      checkConfig: { operation: 'checkVerification' },
    },
  },
};

const OTP_SUB_STEP = listCompiledNames(OTP_STEP).at(-1)!;

const subStepDoc: AuthoredDocument = {
  steps: [
    OTP_STEP,
    {
      name: 'route',
      type: STEP_TYPE.custom,
      config: { transitions: [{ status: 'success', target: OTP_SUB_STEP }] },
    },
  ],
};

describe('connect', () => {
  const doc: AuthoredDocument = {
    steps: [
      { name: 'a', type: 'form', edges: { success: [{ when, target: 'b' }, { target: UNWIRED }] } },
      { name: 'b', type: 'terminal' },
      { name: 'c', type: 'terminal' },
    ],
  };

  it('wires an unwired port to a plain edge', () => {
    const next = connect({ steps: [{ name: 'a', type: 'form' }] }, 'a', 'success', 'b');

    expect(next.steps[0]?.edges).toEqual({ success: 'b' });
  });

  it('fills the first unwired arm of a port', () => {
    expect(connect(doc, 'a', 'success', 'c').steps[0]?.edges?.success).toEqual([
      { when, target: 'b' },
      { target: 'c' },
    ]);
  });

  it('replaces what a plain edge pointed at', () => {
    const plain = connect(
      { steps: [{ name: 'a', type: 'form', edges: { success: 'b' } }] },
      'a',
      'success',
      'c',
    );

    expect(plain.steps[0]?.edges?.success).toBe('c');
  });

  it('rewires only the arm whose handle was dragged', () => {
    const next = connect(doc, 'a', toArmHandle('success', 0), 'c');

    expect(next.steps[0]?.edges?.success).toEqual([{ when, target: 'c' }, { target: UNWIRED }]);
  });

  it('sets the target of a custom step transition', () => {
    const custom: AuthoredDocument = {
      steps: [
        {
          name: 'a',
          type: 'custom',
          config: { transitions: [{ status: 'success' }, { status: 'rejected' }] },
        },
      ],
    };

    const next = connect(custom, 'a', toTransitionPort(1), 'b');

    expect(next.steps[0]?.config?.transitions).toEqual([
      { status: 'success' },
      { status: 'rejected', target: 'b' },
    ]);
  });

  it('leaves other steps alone', () => {
    expect(connect(doc, 'a', 'success', 'c').steps.slice(1)).toEqual(doc.steps.slice(1));
  });
});

describe('disconnect', () => {
  const doc: AuthoredDocument = {
    steps: [
      {
        name: 'a',
        type: 'form',
        edges: { success: 'b', other: [{ when, target: 'b' }, { target: 'c' }] },
      },
      { name: 'b', type: 'terminal' },
    ],
  };

  it('removes a plain edge', () => {
    expect(disconnect(doc, 'a', 'success', null).steps[0]?.edges).toEqual({
      other: [{ when, target: 'b' }, { target: 'c' }],
    });
  });

  it('unwires one arm and keeps its condition', () => {
    expect(disconnect(doc, 'a', 'other', 0).steps[0]?.edges?.other).toEqual([
      { when, target: UNWIRED },
      { target: 'c' },
    ]);
  });

  it('removes a port whose lone arm is emptied', () => {
    const lone: AuthoredDocument = {
      steps: [{ name: 'a', type: 'form', edges: { success: [{ target: 'review' }] } }],
    };

    expect(disconnect(lone, 'a', 'success', 0).steps[0]?.edges).toEqual({});
  });

  it('keeps the webhook of a lone arm and unwires it', () => {
    const webhook = { notify: false } as const;
    const lone: AuthoredDocument = {
      steps: [{ name: 'a', type: 'form', edges: { success: [{ target: 'review', webhook }] } }],
    };

    expect(disconnect(lone, 'a', 'success', 0).steps[0]?.edges?.success).toEqual([
      { target: UNWIRED, webhook },
    ]);
  });

  it('keeps an unconditional arm unwired beside other arms', () => {
    expect(disconnect(doc, 'a', 'other', 1).steps[0]?.edges?.other).toEqual([
      { when, target: 'b' },
      { target: UNWIRED },
    ]);
  });

  it('unwires a custom transition and keeps its status', () => {
    const custom: AuthoredDocument = {
      steps: [
        {
          name: 'a',
          type: 'custom',
          config: { transitions: [{ status: 'success', target: 'b' }] },
        },
      ],
    };

    expect(
      disconnect(custom, 'a', toTransitionPort(0), null).steps[0]?.config?.transitions,
    ).toEqual([{ status: 'success', target: UNWIRED }]);
  });

  it('does nothing for a step without edges', () => {
    const bare: AuthoredDocument = { steps: [{ name: 'a', type: 'form' }] };

    expect(disconnect(bare, 'a', 'success', null)).toEqual(bare);
  });
});

describe('setArms', () => {
  const wired: AuthoredDocument = {
    steps: [{ name: 'a', type: 'form', edges: { success: 'b' } }],
  };

  it('keeps a branched port as a list, fallback last', () => {
    expect(
      setArms(wired, 'a', 'success', [{ when, target: 'c' }, { target: 'b' }]).steps[0]?.edges
        ?.success,
    ).toEqual([{ when, target: 'c' }, { target: 'b' }]);
  });

  it('collapses to a plain edge once only the fallback is left', () => {
    expect(setArms(wired, 'a', 'success', [{ target: 'c' }]).steps[0]?.edges?.success).toBe('c');
  });

  it('keeps a lone condition as a list', () => {
    expect(
      setArms(wired, 'a', 'success', [{ when, target: 'c' }]).steps[0]?.edges?.success,
    ).toEqual([{ when, target: 'c' }]);
  });

  it('unwires the port when no arm is left', () => {
    const next = setArms(wired, 'a', 'success', []);

    expect(next.steps[0]?.edges).toEqual({});
    expect(readArms(next.steps[0]!, 'success')).toEqual([]);
  });
});

describe('deleteStep', () => {
  it('unwires a transition that targeted one of its sub-steps', () => {
    const next = deleteStep(subStepDoc, 'otp');

    expect(next.steps[0]?.config?.transitions).toEqual([{ status: 'success', target: UNWIRED }]);
  });

  const doc: AuthoredDocument = {
    initial: 'b',
    steps: [
      {
        name: 'a',
        type: 'form',
        edges: { success: 'b', retry: [{ when, target: 'b' }, { target: 'c' }] },
      },
      { name: 'b', type: 'terminal' },
      { name: 'c', type: 'custom', config: { transitions: [{ status: 'success', target: 'b' }] } },
    ],
  };

  it('removes the step and the plain edges that targeted it', () => {
    const next = deleteStep(doc, 'b');

    expect(next.steps.map((step) => step.name)).toEqual(['a', 'c']);
    expect(next.steps[0]?.edges).toHaveProperty('retry');
    expect(next.steps[0]?.edges).not.toHaveProperty('success');
  });

  it('removes a port whose lone arm targeted the step', () => {
    const lone: AuthoredDocument = {
      steps: [
        { name: 'a', type: 'form', edges: { success: [{ target: 'review' }] } },
        { name: 'review', type: 'terminal' },
      ],
    };

    expect(deleteStep(lone, 'review').steps[0]?.edges).toEqual({});
  });

  it('leaves arms and transitions with an empty target, keeping their conditions', () => {
    const next = deleteStep(doc, 'b');

    expect(next.steps[0]?.edges?.retry).toEqual([{ when, target: UNWIRED }, { target: 'c' }]);
    expect(next.steps[1]?.config?.transitions).toEqual([{ status: 'success', target: UNWIRED }]);
  });

  it('clears initial when the initial step goes', () => {
    expect(deleteStep(doc, 'b')).not.toHaveProperty('initial');
    expect(deleteStep(doc, 'c').initial).toBe('b');
  });

  it("drops the deleted step's agreements and keeps the others", () => {
    const withAgreements: AuthoredDocument = {
      ...doc,
      agreements: [
        { key: 'terms', step: 'b', acceptedWhen: 'ok' },
        { key: 'privacy', step: 'c', acceptedWhen: 'ok' },
      ],
    };

    expect(deleteStep(withAgreements, 'b').agreements).toEqual([
      { key: 'privacy', step: 'c', acceptedWhen: 'ok' },
    ]);
  });

  it('removes agreements once none are left', () => {
    const withAgreement: AuthoredDocument = {
      ...doc,
      agreements: [{ key: 'terms', step: 'b', acceptedWhen: 'ok' }],
    };

    expect(deleteStep(withAgreement, 'b')).not.toHaveProperty('agreements');
  });
});

describe('renameField', () => {
  const onOld = { field: 'old', equals: 'yes' };
  const onNew = { field: 'new', equals: 'yes' };

  const doc: AuthoredDocument = {
    agreements: [
      { key: 'terms', step: 'collect', acceptedWhen: 'old' },
      { key: 'other', step: 'later', acceptedWhen: 'old' },
    ],
    steps: [
      {
        name: 'collect',
        type: 'form',
        config: {
          fields: {
            first: { type: 'text', required: true },
            old: { type: 'boolean', required: true },
            last: { type: 'text', required: false, when: onOld },
          },
          canonical: { email: 'old', phone: 'first' },
        },
        edges: { success: [{ when: { not: onOld }, target: 'later' }, { target: 'route' }] },
        scoring: [{ score: 'risk', add: 1, when: onOld }],
      },
      {
        name: 'later',
        type: 'form',
        config: {
          fields: {
            nested: {
              type: 'object',
              required: true,
              fields: { inner: { type: 'text', required: false, when: onOld } },
            },
          },
        },
      },
      {
        name: 'route',
        type: 'decision',
        config: {
          branches: [{ port: 'yes', when: { all: [onOld, { score: 'old', gte: 1 }] } }],
        },
      },
      {
        name: 'score',
        type: 'risk-score',
        config: { rules: [{ score: 'risk', add: 1, when: { any: [onOld] } }] },
      },
      {
        name: 'call',
        type: 'connector-call',
        config: {
          connectors: [
            {
              name: 'c',
              id: 'x',
              type: 'custom',
              order: 1,
              fieldMapping: { old: 'old', keep: 'first' },
              optionalFieldMapping: { maybe: 'old' },
              fallback: [{ name: 'f', id: 'y', type: 'custom', fieldMapping: { old: 'old' } }],
            },
          ],
        },
      },
      {
        name: 'mail',
        type: 'notify',
        config: {
          connector: { id: 'sendgrid_email', fieldMapping: { to: 'old' } },
          recipientField: 'old',
        },
      },
      {
        name: 'raw',
        type: 'custom',
        config: {
          transitions: [{ status: 'success', target: 'mail', when: onOld }],
          scoring: [{ score: 'risk', add: 1, when: onOld }],
        },
      },
      {
        name: 'http',
        type: 'http-call',
        config: { request: { method: 'POST', url: 'https://x/', body: { old: 'old' } } },
      },
      { name: 'choose', type: 'document-choice', config: { field: 'old', documents: [] } },
    ],
  };

  const findStep = (next: AuthoredDocument, name: string) =>
    next.steps.find((step) => step.name === name);

  it('renames the field in place and reports references updated', () => {
    const { doc: next, referencesUpdated } = renameField(doc, 'collect', 'old', 'new');

    expect(referencesUpdated).toBe(true);
    expect(Object.keys(findStep(next, 'collect')?.config?.fields as object)).toEqual([
      'first',
      'new',
      'last',
    ]);
  });

  it('rewrites conditions in field whens, edge arms, scoring, branches, rules and transitions', () => {
    const { doc: next } = renameField(doc, 'collect', 'old', 'new');

    expect(findStep(next, 'collect')?.config?.fields).toMatchObject({ last: { when: onNew } });
    expect(findStep(next, 'collect')?.edges?.success).toEqual([
      { when: { not: onNew }, target: 'later' },
      { target: 'route' },
    ]);
    expect(findStep(next, 'collect')?.scoring).toEqual([{ score: 'risk', add: 1, when: onNew }]);
    expect(findStep(next, 'later')?.config?.fields).toMatchObject({
      nested: { fields: { inner: { when: onNew } } },
    });
    expect(findStep(next, 'route')?.config?.branches).toEqual([
      { port: 'yes', when: { all: [onNew, { score: 'old', gte: 1 }] } },
    ]);
    expect(findStep(next, 'score')?.config?.rules).toEqual([
      { score: 'risk', add: 1, when: { any: [onNew] } },
    ]);
    expect(findStep(next, 'raw')?.config).toEqual({
      transitions: [{ status: 'success', target: 'mail', when: onNew }],
      scoring: [{ score: 'risk', add: 1, when: onNew }],
    });
  });

  it('rewrites canonical, connector mappings, recipientField and its own acceptedWhen', () => {
    const { doc: next } = renameField(doc, 'collect', 'old', 'new');

    expect(findStep(next, 'collect')?.config?.canonical).toEqual({ email: 'new', phone: 'first' });
    expect(findStep(next, 'call')?.config?.connectors).toEqual([
      {
        name: 'c',
        id: 'x',
        type: 'custom',
        order: 1,
        fieldMapping: { old: 'new', keep: 'first' },
        optionalFieldMapping: { maybe: 'new' },
        fallback: [{ name: 'f', id: 'y', type: 'custom', fieldMapping: { old: 'new' } }],
      },
    ]);
    expect(findStep(next, 'mail')?.config).toEqual({
      connector: { id: 'sendgrid_email', fieldMapping: { to: 'new' } },
      recipientField: 'new',
    });
    expect(next.agreements).toEqual([
      { key: 'terms', step: 'collect', acceptedWhen: 'new' },
      { key: 'other', step: 'later', acceptedWhen: 'old' },
    ]);
  });

  it('leaves same-named keys that are not references alone', () => {
    const { doc: next } = renameField(doc, 'collect', 'old', 'new');

    expect(findStep(next, 'http')).toEqual(findStep(doc, 'http'));
    expect(findStep(next, 'choose')).toEqual(findStep(doc, 'choose'));
  });

  it("rewrites an http-call's fieldMapping sources and keeps its payload keys", () => {
    const withMapping: AuthoredDocument = {
      steps: [
        doc.steps[0]!,
        {
          name: 'http',
          type: 'http-call',
          config: {
            request: {
              method: 'POST',
              url: 'https://x/{{payload.old}}',
              body: { b: '{{payload.p}}' },
            },
            fieldMapping: { p: 'old', old: 'first' },
          },
        },
      ],
    };

    const { doc: next } = renameField(withMapping, 'collect', 'old', 'new');

    expect(findStep(next, 'http')?.config).toEqual({
      request: { method: 'POST', url: 'https://x/{{payload.old}}', body: { b: '{{payload.p}}' } },
      fieldMapping: { p: 'new', old: 'first' },
    });
  });

  it('leaves an http-call placeholder as written, so the step reports it reads a missing field', () => {
    const implicit: AuthoredDocument = {
      steps: [
        doc.steps[0]!,
        {
          name: 'http',
          type: 'http-call',
          config: {
            request: { method: 'POST', url: 'https://x/', headers: { h: '{{ payload.old }}' } },
          },
        },
      ],
    };

    const { doc: next } = renameField(implicit, 'collect', 'old', 'new');

    expect(findStep(next, 'http')?.config?.request).toEqual({
      method: 'POST',
      url: 'https://x/',
      headers: { h: '{{ payload.old }}' },
    });
    expect(projectDocument(next).steps.find((step) => step.step.name === 'http')?.issues).toContain(
      'payload old reads missing field old',
    );
  });

  it('renames only the field when another step declares the same field name', () => {
    const ambiguous: AuthoredDocument = {
      ...doc,
      steps: [
        ...doc.steps,
        {
          name: 'twin',
          type: 'custom',
          config: { data: { old: { type: 'text', required: true } }, transitions: [] },
        },
      ],
    };

    const { doc: next, referencesUpdated } = renameField(ambiguous, 'collect', 'old', 'new');

    expect(referencesUpdated).toBe(false);
    expect(findStep(next, 'collect')?.config?.fields).toHaveProperty('new');
    expect(findStep(next, 'collect')?.config?.fields).toMatchObject({ last: { when: onOld } });
    expect(findStep(next, 'collect')?.config?.canonical).toEqual({ email: 'old', phone: 'first' });
    expect(findStep(next, 'twin')).toEqual(findStep(ambiguous, 'twin'));
    expect(next.agreements).toEqual(ambiguous.agreements);
  });

  it("treats another step's included section declaring the name as ambiguous", () => {
    const ambiguous: AuthoredDocument = {
      ...doc,
      steps: [
        ...doc.steps,
        {
          name: 'twin',
          type: 'form',
          include: [
            { type: 'form', config: { fields: { old: { type: 'text', required: true } } } },
          ],
        },
      ],
    };

    expect(renameField(ambiguous, 'collect', 'old', 'new').referencesUpdated).toBe(false);
  });

  it("treats a field another step type creates by itself, like contact-details' email, as ambiguous", () => {
    const byEmail = { field: 'email', isSet: true };
    const ambiguous: AuthoredDocument = {
      steps: [
        {
          name: 'collect',
          type: 'form',
          config: { fields: { email: { type: 'text', required: true } } },
        },
        { name: 'contact', type: 'contact-details', config: { email: 'required' } },
        { name: 'route', type: 'decision', config: { branches: [{ port: 'yes', when: byEmail }] } },
      ],
    };

    const { doc: next, referencesUpdated } = renameField(ambiguous, 'collect', 'email', 'mail');

    expect(referencesUpdated).toBe(false);
    expect(next.steps.find((step) => step.name === 'collect')?.config?.fields).toHaveProperty(
      'mail',
    );
    expect(next.steps.find((step) => step.name === 'route')).toEqual(ambiguous.steps[2]);
  });
});

describe('renameStep', () => {
  const doc: AuthoredDocument = {
    initial: 'a',
    agreements: [{ key: 'terms', step: 'a', acceptedWhen: 'ok' }],
    steps: [
      {
        name: 'a',
        type: 'form',
        edges: { success: 'b', retry: [{ when, target: 'a' }, { target: 'b' }] },
      },
      {
        name: 'b',
        type: 'custom',
        config: { transitions: [{ status: 'success', target: 'a' }, { status: 'rejected' }] },
      },
    ],
  };

  it('renames a transition that targeted one of its sub-steps', () => {
    const next = renameStep(subStepDoc, 'otp', 'phone');

    expect(OTP_SUB_STEP).not.toBe('otp');
    expect(next.steps[1]?.config?.transitions).toEqual([
      { status: 'success', target: listCompiledNames(next.steps[0]!).at(-1) },
    ]);
    expect(listCompiledNames(next.steps[0]!).at(-1)).not.toBe(OTP_SUB_STEP);
  });

  it('rewires every reference to the old name', () => {
    const next = renameStep(doc, 'a', 'start');

    expect(next.steps[0]?.name).toBe('start');
    expect(next.steps[0]?.edges?.retry).toEqual([{ when, target: 'start' }, { target: 'b' }]);
    expect(next.steps[1]?.config?.transitions).toEqual([
      { status: 'success', target: 'start' },
      { status: 'rejected' },
    ]);
    expect(next.initial).toBe('start');
    expect(next.agreements).toEqual([{ key: 'terms', step: 'start', acceptedWhen: 'ok' }]);
  });

  it('renames a plain edge that pointed at the step', () => {
    expect(renameStep(doc, 'b', 'end').steps[0]?.edges?.success).toBe('end');
  });

  it('keeps initial and agreements when they name another step', () => {
    const next = renameStep(doc, 'b', 'end');

    expect(next.initial).toBe('a');
    expect(next.agreements).toEqual(doc.agreements);
  });
});

describe('findRenameProblem', () => {
  const doc: AuthoredDocument = {
    steps: [
      { name: 'a', type: 'form' },
      addStep({ steps: [] }, 'otp-verify', { x: 0, y: 0 }).doc.steps[0]!,
      { name: 'b', type: 'terminal' },
    ],
  };

  it('accepts a free name', () => {
    expect(findRenameProblem(doc, 'a', 'start')).toBeNull();
  });

  it('refuses an empty name', () => {
    expect(findRenameProblem(doc, 'a', '')).toBe('A step needs a name');
  });

  it('refuses characters the schema does not allow', () => {
    expect(findRenameProblem(doc, 'a', 'two words')).toBe('Use only letters, digits, _ and -');
  });

  it('refuses a reserved name', () => {
    expect(findRenameProblem(doc, 'a', 'constructor')).toBe('constructor is a reserved name');
  });

  it('refuses a name another step already has', () => {
    expect(findRenameProblem(doc, 'a', 'b')).toBe('b would compile two steps named b');
  });

  it('refuses a name that collides with a compiled sub-step name', () => {
    const subStep = listSubStepName(doc);

    expect(findRenameProblem(doc, 'a', subStep)).toBe(`${subStep} is already a step name`);
  });

  it('refuses a rename whose own sub-steps would take another step name', () => {
    const subStep = listSubStepName(doc);
    const key = subStep.slice(doc.steps[1]!.name.length);
    const clash: AuthoredDocument = {
      steps: [doc.steps[1]!, { name: `phone${key}`, type: 'terminal' }],
    };

    expect(findRenameProblem(clash, doc.steps[1]!.name, 'phone')).toBe(
      `phone${key} is already a step name`,
    );
  });
});

function listSubStepName(doc: AuthoredDocument): string {
  const resolved = tryResolveStep(doc.steps[1]!, 1);
  if (resolved.kind !== 'resolved') throw new Error('otp-verify must resolve');
  return resolved.resolved.stepNames[1]!;
}

describe('setRootKeys', () => {
  const doc: AuthoredDocument = {
    id: 'kyc',
    version: 3,
    name: 'Old',
    steps: [{ name: 'a', type: 'terminal' }],
    webhook: { notify: { path: 'notify' } },
  };
  const keys = ['name', 'webhook', 'scoring', 'agreements'] as const;

  it('changes a key in place, so the JSON keeps its order', () => {
    const next = setRootKeys(doc, keys, { name: 'New', webhook: doc.webhook });

    expect(Object.keys(next)).toEqual(['id', 'version', 'name', 'steps', 'webhook']);
    expect(next.name).toBe('New');
  });

  it('unsets a key left out and appends one set for the first time', () => {
    const next = setRootKeys(doc, keys, { name: 'Old', scoring: { risk: { min: 0, max: 100 } } });

    expect(Object.keys(next)).toEqual(['id', 'version', 'name', 'steps', 'scoring']);
  });
});

describe('setInitial and setConfig', () => {
  const doc: AuthoredDocument = {
    steps: [
      { name: 'a', type: 'form' },
      { name: 'b', type: 'form' },
    ],
  };

  it('sets the initial step', () => {
    expect(setInitial(doc, 'b').initial).toBe('b');
  });

  it('replaces only the named step config', () => {
    const next = setConfig(doc, 'b', { fields: {} });

    expect(next.steps[0]).not.toHaveProperty('config');
    expect(next.steps[1]?.config).toEqual({ fields: {} });
  });
});

describe('positions', () => {
  const doc: AuthoredDocument = {
    steps: [
      { name: 'a', type: 'form', meta: { position: { x: 1, y: 2 }, note: 'keep' } },
      { name: 'b', type: 'form', meta: { position: { x: 3, y: 4 } } },
      { name: 'c', type: 'form' },
    ],
  };

  it('snaps a position to the grid', () => {
    expect(snapToGrid({ x: GRID_SIZE + 1, y: GRID_SIZE * 2 - 1 })).toEqual({
      x: GRID_SIZE,
      y: GRID_SIZE * 2,
    });
  });

  it('writes the snapped position under meta.position and keeps other meta', () => {
    const next = setPositions(doc, new Map([['a', { x: 13, y: 27 }]]));

    expect(next.steps[0]?.meta).toEqual({ note: 'keep', position: { x: 16, y: 24 } });
    expect(next.steps[1]).toEqual(doc.steps[1]);
  });

  it('pins every unpositioned step at its shown spot once any step has a position', () => {
    const shown = new Map([
      ['a', { x: 100, y: 100 }],
      ['c', { x: 40, y: 80 }],
    ]);

    const next = pinPositions(doc, shown);

    expect(next.steps[0]?.meta).toEqual(doc.steps[0]?.meta);
    expect(next.steps[2]?.meta).toEqual({ position: { x: 40, y: 80 } });
  });

  it('leaves a document with no positions as it is', () => {
    const unplaced: AuthoredDocument = { steps: [{ name: 'c', type: 'form' }] };

    expect(hasPositions(unplaced)).toBe(false);
    expect(pinPositions(unplaced, new Map([['c', { x: 0, y: 0 }]]))).toBe(unplaced);
  });
});

describe('addStep', () => {
  const doc: AuthoredDocument = { id: 'eu-kyc', steps: [{ name: 'form_1', type: 'form' }] };

  it('names the step after its type with the first free counter', () => {
    const { name } = addStep(doc, 'form', { x: 0, y: 0 });

    expect(name).toBe('form_2');
  });

  it('turns hyphens in the type into underscores', () => {
    expect(addStep(doc, 'contact-details', { x: 0, y: 0 }).name).toBe('contact_details_1');
  });

  it('appends the step with a snapped position', () => {
    const { doc: next } = addStep(doc, 'terminal', { x: 13, y: 5 });

    expect(next.steps.at(-1)?.meta).toEqual({ position: { x: 16, y: 8 } });
    expect(doc.steps).toHaveLength(1);
  });

  it('names a starter form field after the step', () => {
    const { doc: next } = addStep(doc, 'form', { x: 0, y: 0 });

    expect(next.steps.at(-1)?.config).toEqual({
      fields: { form_2_value: { type: 'text', required: true } },
    });
  });

  it('gives a new KYC step a source key derived from the workflow id', () => {
    const { doc: next } = addStep(doc, 'kyc-identity-verification', { x: 0, y: 0 });

    expect(next.steps.at(-1)?.config?.sourceKey).toBe('eu_kyc');
  });

  it.each(listStepTypes().map((type) => type.type))('produces a resolvable %s step', (type) => {
    const { doc: next } = addStep(doc, type, { x: 0, y: 0 });
    const outcome = tryResolveStep(next.steps.at(-1)!, 0);

    expect(outcome.kind).toBe('resolved');
  });
});

describe('includes', () => {
  const doc: AuthoredDocument = {
    steps: [{ name: 'collect', type: 'contact-details', config: { email: 'required' } }],
  };

  it('appends a section with its starter config, a form field named after the step and section', () => {
    expect(addInclude(doc, 'collect', 'form').steps[0]?.include).toEqual([
      {
        type: 'form',
        config: { fields: { collect_form_value: { type: 'text', required: true } } },
      },
    ]);
  });

  it('refuses a section type the step already has, its own type included', () => {
    const once = addInclude(doc, 'collect', 'form');

    expect(addInclude(once, 'collect', 'form')).toEqual(once);
    expect(addInclude(doc, 'collect', 'contact-details')).toEqual(doc);
  });

  it('removes one section and keeps the rest', () => {
    const twice = addInclude(addInclude(doc, 'collect', 'consents'), 'collect', 'address');

    expect(
      removeInclude(twice, 'collect', 0).steps[0]?.include?.map((entry) => entry.type),
    ).toEqual(['address']);
  });

  it('drops the key with the last section', () => {
    const next = removeInclude(addInclude(doc, 'collect', 'consents'), 'collect', 0);

    expect(next.steps[0]).not.toHaveProperty('include');
  });

  it('sets the config of the step itself or of one include', () => {
    const withInclude = addInclude(doc, 'collect', 'consents');

    expect(
      setSectionConfig(withInclude, 'collect', null, { email: 'optional' }).steps[0]?.config,
    ).toEqual({
      email: 'optional',
    });
    expect(
      setSectionConfig(withInclude, 'collect', 0, { consents: [] }).steps[0]?.include?.[0]?.config,
    ).toEqual({ consents: [] });
  });
});

describe('setScoringRules', () => {
  const doc: AuthoredDocument = {
    scoring: { risk: { min: 0, max: 100 } },
    steps: [
      { name: 'a', type: 'form', scoring: [{ score: 'risk', add: 5 }] },
      { name: 'b', type: 'form' },
    ],
  };

  it('writes the rules of one step and leaves the others', () => {
    const rules = [{ score: 'risk', add: -3, when: { field: 'x', isSet: true } }];
    const next = setScoringRules(doc, 'b', rules);

    expect(next.steps[1]?.scoring).toEqual(rules);
    expect(next.steps[0]).toBe(doc.steps[0]);
  });

  it('takes the scoring key away with the last rule', () => {
    const next = setScoringRules(doc, 'a', []);

    expect(next.steps[0]).toEqual({ name: 'a', type: 'form' });
    expect('scoring' in next.steps[0]!).toBe(false);
  });
});

describe('setConfigScoringRules', () => {
  const doc: AuthoredDocument = {
    steps: [
      {
        name: 'a',
        type: 'custom',
        config: { status: 'awaiting_user', scoring: [{ score: 'risk', add: 5 }], transitions: [] },
        scoring: [{ score: 'trust', add: 1 }],
      },
      { name: 'b', type: 'custom', config: { transitions: [] } },
    ],
  };

  it('writes config.scoring of one step and leaves step-level rules and other keys', () => {
    const rules = [{ score: 'risk', add: -2 }];
    const next = setConfigScoringRules(doc, 'a', rules);

    expect(next.steps[0]?.config?.scoring).toEqual(rules);
    expect(next.steps[0]?.config?.status).toBe('awaiting_user');
    expect(next.steps[0]?.scoring).toEqual([{ score: 'trust', add: 1 }]);
    expect(next.steps[1]).toBe(doc.steps[1]);
  });

  it('takes the config.scoring key away with the last rule', () => {
    const next = setConfigScoringRules(doc, 'a', []);

    expect('scoring' in (next.steps[0]?.config ?? {})).toBe(false);
    expect(next.steps[0]?.config?.transitions).toEqual([]);
  });

  it('adds the key to a config that had none', () => {
    const next = setConfigScoringRules(doc, 'b', [{ score: 'risk', add: 1 }]);

    expect(next.steps[1]?.config?.scoring).toEqual([{ score: 'risk', add: 1 }]);
  });
});

describe('setAgreements', () => {
  const doc: AuthoredDocument = { id: 'w', steps: [] };
  const agreement = { key: 'terms', step: 'agree', acceptedWhen: 'termsAccepted' };

  it('writes the agreements, and drops the key when none are left', () => {
    const set = setAgreements(doc, [agreement]);

    expect(set.agreements).toEqual([agreement]);
    expect('agreements' in setAgreements(set, [])).toBe(false);
  });
});
