import { describe, expect, it } from 'vitest';
import {
  isBranched,
  listCompiledNames,
  listScoringRules,
  parseDocument,
  readArmHandle,
  readArms,
  readTransitionIndex,
  readTransitions,
  toArmHandle,
  toTransitionPort,
  type AuthoredStep,
} from './authored-document';

describe('parseDocument', () => {
  it('returns the document when it is an object with a steps array', () => {
    expect(parseDocument('{"steps":[]}')).toEqual({ steps: [] });
  });

  it('returns the parser message for malformed JSON', () => {
    expect(typeof parseDocument('{"steps":')).toBe('string');
  });

  it.each(['[]', 'null', '3', '"x"'])('refuses %s as not an object', (text) => {
    expect(parseDocument(text)).toBe('The document is not a JSON object.');
  });

  it('refuses a document without a steps array', () => {
    expect(parseDocument('{"steps":{}}')).toBe('The document has no `steps` array.');
    expect(parseDocument('{}')).toBe('The document has no `steps` array.');
  });
});

describe('arms and handles', () => {
  const when = { field: 'x', isSet: true };
  const step: AuthoredStep = {
    name: 'a',
    type: 'form',
    edges: { success: [{ when, target: 'b' }, { target: 'c' }], plain: 'd' },
  };

  it('reads a plain edge as one arm and an unwired port as none', () => {
    expect(readArms(step, 'plain')).toEqual([{ target: 'd' }]);
    expect(readArms(step, 'missing')).toEqual([]);
  });

  it('calls a port branched only when an arm has a condition', () => {
    expect(isBranched(step.edges?.success)).toBe(true);
    expect(isBranched(step.edges?.plain)).toBe(false);
    expect(isBranched([{ target: 'b' }])).toBe(false);
    expect(isBranched(undefined)).toBe(false);
  });

  it('round-trips an arm handle and reads a port handle as null', () => {
    expect(readArmHandle(toArmHandle('success', 2))).toEqual({ port: 'success', armIndex: 2 });
    expect(readArmHandle('success')).toBeNull();
  });

  it('round-trips a transition port and reads an ordinary port as null', () => {
    expect(readTransitionIndex(toTransitionPort(3))).toBe(3);
    expect(readTransitionIndex('success')).toBeNull();
  });
});

describe('readTransitions', () => {
  it('reads them only from a custom step', () => {
    const transitions = [{ status: 'success' as const, target: 'b' }];

    expect(readTransitions({ name: 'a', type: 'custom', config: { transitions } })).toEqual(
      transitions,
    );
    expect(readTransitions({ name: 'a', type: 'form', config: { transitions } })).toEqual([]);
    expect(readTransitions({ name: 'a', type: 'custom' })).toEqual([]);
  });
});

describe('listCompiledNames', () => {
  it('lists the step name for a custom or unknown type', () => {
    expect(listCompiledNames({ name: 'a', type: 'custom' })).toEqual(['a']);
    expect(listCompiledNames({ name: 'a', type: 'nope' })).toEqual(['a']);
  });

  it('adds the sub-steps a type compiles to, honouring renames', () => {
    const otp: AuthoredStep = {
      name: 'phone',
      type: 'otp-verify',
      config: {
        channel: 'sms',
        connector: {
          id: 'twilio_sms_otp',
          startConfig: { operation: 'startVerification' },
          checkConfig: { operation: 'checkVerification' },
        },
      },
    };

    const names = listCompiledNames(otp);
    expect(names[0]).toBe('phone');
    expect(names.length).toBeGreaterThan(1);
    expect(names.slice(1).every((name) => name.startsWith('phone_'))).toBe(true);
  });

  it('keeps only the entry name when the config is invalid', () => {
    expect(listCompiledNames({ name: 'a', type: 'form', config: { fields: 5 } })).toEqual(['a']);
  });
});

describe('listScoringRules', () => {
  const rule = (score: string): { score: string; add: number } => ({ score, add: 1 });

  it('lists a custom step’s config rules before its step-level ones', () => {
    const step: AuthoredStep = {
      name: 'a',
      type: 'custom',
      config: { scoring: [rule('risk')], transitions: [] },
      scoring: [rule('trust')],
    };

    expect(listScoringRules(step)).toEqual([rule('risk'), rule('trust')]);
  });

  it('reads config.scoring on a custom step only', () => {
    const config = { scoring: [rule('risk')] };

    expect(listScoringRules({ name: 'a', type: 'form', config })).toEqual([]);
  });
});
