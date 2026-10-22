import { describe, expect, it } from 'vitest';
import {
  addInclude,
  connect,
  projectDocument,
  toArmHandle,
  readArms,
  removeInclude,
  setArms,
  setRootKeys,
  type AuthoredDocument,
} from './authored-graph';

const DOC: AuthoredDocument = {
  steps: [{ name: 'collect', type: 'contact-details', config: { email: 'required' } }],
};

describe('includes', () => {
  it('appends a section with its starter config, a form field named after the step and section', () => {
    const next = addInclude(DOC, 'collect', 'form');

    expect(next.steps[0]?.include).toEqual([
      {
        type: 'form',
        config: { fields: { collect_form_value: { type: 'text', required: true } } },
      },
    ]);
  });

  it('removes one section and keeps the rest', () => {
    const twice = addInclude(addInclude(DOC, 'collect', 'consents'), 'collect', 'address');

    expect(
      removeInclude(twice, 'collect', 0).steps[0]?.include?.map((entry) => entry.type),
    ).toEqual(['address']);
  });

  it('drops the key with the last section, since the schema refuses an empty include', () => {
    const next = removeInclude(addInclude(DOC, 'collect', 'consents'), 'collect', 0);

    expect(next.steps[0]).not.toHaveProperty('include');
  });
});

describe('conditional branches', () => {
  const WIRED: AuthoredDocument = {
    steps: [
      { name: 'a', type: 'form', edges: { success: 'b' } },
      { name: 'b', type: 'terminal' },
      { name: 'c', type: 'terminal' },
    ],
  };
  const when = { field: 'x', isSet: true };

  it('reads a plain edge as one arm with no condition, and an unwired port as none', () => {
    expect(readArms(WIRED.steps[0]!, 'success')).toEqual([{ target: 'b' }]);
    expect(readArms(WIRED.steps[1]!, 'success')).toEqual([]);
  });

  it('keeps a branched port as a list, fallback last', () => {
    const next = setArms(WIRED, 'a', 'success', [{ when, target: 'c' }, { target: 'b' }]);

    expect(next.steps[0]?.edges?.success).toEqual([{ when, target: 'c' }, { target: 'b' }]);
  });

  it('collapses back to a plain edge once only the fallback is left', () => {
    expect(setArms(WIRED, 'a', 'success', [{ target: 'c' }]).steps[0]?.edges?.success).toBe('c');
  });

  it('keeps a lone condition as a list, since a plain edge would drop it', () => {
    expect(
      setArms(WIRED, 'a', 'success', [{ when, target: 'c' }]).steps[0]?.edges?.success,
    ).toEqual([{ when, target: 'c' }]);
  });

  it('unwires the port when no arm is left', () => {
    expect(setArms(WIRED, 'a', 'success', []).steps[0]?.edges).toEqual({});
  });
});

describe('workflow settings', () => {
  const DOC: AuthoredDocument = {
    id: 'kyc',
    version: 3,
    name: 'Old',
    steps: [{ name: 'a', type: 'terminal' }],
    webhook: { notify: { path: 'notify' } },
  };
  const KEYS = ['name', 'webhook', 'scoring', 'agreements'];

  it('changes a key in place, so the JSON keeps its order', () => {
    const next = setRootKeys(DOC, KEYS, { name: 'New', webhook: DOC.webhook });

    expect(Object.keys(next)).toEqual(['id', 'version', 'name', 'steps', 'webhook']);
    expect(next.name).toBe('New');
  });

  it('unsets a key left out and appends one set for the first time', () => {
    const next = setRootKeys(DOC, KEYS, { name: 'Old', scoring: { risk: { min: 0 } } });

    expect(Object.keys(next)).toEqual(['id', 'version', 'name', 'steps', 'scoring']);
  });
});

describe('branch handles', () => {
  const when = { field: 'x', isSet: true };
  const BRANCHED: AuthoredDocument = {
    steps: [
      { name: 'a', type: 'form', edges: { success: [{ when, target: 'b' }, { target: 'c' }] } },
      { name: 'b', type: 'terminal' },
      { name: 'c', type: 'terminal' },
    ],
  };

  it('gives each branch of a branched port a handle of its own', () => {
    const handles = projectDocument(BRANCHED).edges.map((edge) => edge.handle);

    expect(handles).toEqual([toArmHandle('success', 0), toArmHandle('success', 1)]);
  });

  it('keeps a plain port on its own handle', () => {
    const plain: AuthoredDocument = { steps: [{ ...BRANCHED.steps[0]!, edges: { success: 'b' } }] };

    expect(projectDocument(plain).edges.map((edge) => edge.handle)).toEqual(['success']);
  });

  it('rewires only the branch whose handle was dragged', () => {
    const next = connect(BRANCHED, 'a', toArmHandle('success', 1), 'b');

    expect(next.steps[0]?.edges?.success).toEqual([{ when, target: 'b' }, { target: 'b' }]);
  });
});
