import { describe, expect, it } from 'vitest';
import type { Connector, ConnectorSettingsIssueReason } from '../types/connector';
import {
  buildConnectorSettingsChanges,
  canSubmitConnectorSettings,
  createConnectorSettingsDraft,
  describeConnectorSettingsIssue,
  hasConnectorSettingsChanges,
  type ConnectorSettingsDraft,
} from './connector-settings-form';

function createConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    type: 'smtp',
    name: 'SMTP',
    configured: false,
    allowAdditionalKeys: false,
    settings: [],
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

describe('createConnectorSettingsDraft', () => {
  it('prefills a non-secret stored value, and seeds initialValue to match', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
      ],
    });

    const draft = createConnectorSettingsDraft(connector);

    expect(draft.fields).toEqual([
      {
        key: 'from',
        secret: false,
        required: true,
        source: 'stored',
        value: 'noreply@tsh.io',
        initialValue: 'noreply@tsh.io',
      },
    ]);
  });

  it('leaves a stored secret input empty, since the engine never returns its value', () => {
    const connector = createConnector({
      settings: [{ key: 'password', secret: true, required: true, source: 'stored' }],
    });

    const draft = createConnectorSettingsDraft(connector);

    expect(draft.fields).toEqual([
      {
        key: 'password',
        secret: true,
        required: true,
        source: 'stored',
        value: '',
        initialValue: '',
      },
    ]);
  });

  it('leaves an unset setting empty regardless of secrecy', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'unset' },
        { key: 'apiKey', secret: true, required: true, source: 'unset' },
      ],
    });

    const draft = createConnectorSettingsDraft(connector);

    expect(draft.fields).toEqual([
      {
        key: 'from',
        secret: false,
        required: true,
        source: 'unset',
        value: '',
        initialValue: '',
      },
      {
        key: 'apiKey',
        secret: true,
        required: true,
        source: 'unset',
        value: '',
        initialValue: '',
      },
    ]);
  });

  it('starts with no custom key rows and no removed keys', () => {
    const draft = createConnectorSettingsDraft(createConnector());

    expect(draft.customKeys).toEqual([]);
    expect(draft.removedKeys).toEqual([]);
  });
});

describe('buildConnectorSettingsChanges', () => {
  it('omits an untouched blank stored secret entirely', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'apiKey',
          secret: true,
          required: true,
          source: 'stored',
          value: '',
          initialValue: '',
        },
      ],
      customKeys: [],
      removedKeys: [],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({});
  });

  it('sends a stored secret the operator typed into', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'apiKey',
          secret: true,
          required: true,
          source: 'stored',
          value: 'new-secret',
          initialValue: '',
        },
      ],
      customKeys: [],
      removedKeys: [],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({ apiKey: 'new-secret' });
  });

  it('sends null for a non-secret stored value the operator emptied', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'from',
          secret: false,
          required: false,
          source: 'stored',
          value: '',
          initialValue: 'noreply@tsh.io',
        },
      ],
      customKeys: [],
      removedKeys: [],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({ from: null });
  });

  it('omits an emptied secret box rather than treating it as a deletion', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'apiKey',
          secret: true,
          required: true,
          source: 'stored',
          value: '',
          initialValue: 'was-typed-then-cleared',
        },
      ],
      customKeys: [],
      removedKeys: [],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({});
  });

  it('omits a field that was never stored and is left blank', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'from',
          secret: false,
          required: false,
          source: 'unset',
          value: '',
          initialValue: '',
        },
      ],
      customKeys: [],
      removedKeys: [],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({});
  });

  it('omits a field edited back to its original text', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'from',
          secret: false,
          required: false,
          source: 'stored',
          value: '  noreply@tsh.io  ',
          initialValue: 'noreply@tsh.io',
        },
      ],
      customKeys: [],
      removedKeys: [],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({});
  });

  it('sends null for each removed key', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [],
      removedKeys: ['kycProvider.token'],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({ 'kycProvider.token': null });
  });

  it('sends a custom key row with a name and a value', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [{ name: 'kycProvider.token', value: 'shh' }],
      removedKeys: [],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({ 'kycProvider.token': 'shh' });
  });

  it('omits an untouched, fully blank custom key row', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [{ name: '', value: '' }],
      removedKeys: [],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({});
  });

  it('trims whitespace from field and custom-key values before sending them', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'from',
          secret: false,
          required: false,
          source: 'stored',
          value: '  a@tsh.io  ',
          initialValue: 'old@tsh.io',
        },
      ],
      customKeys: [{ name: '  kycProvider.token  ', value: '  shh  ' }],
      removedKeys: [],
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({
      from: 'a@tsh.io',
      'kycProvider.token': 'shh',
    });
  });
});

describe('hasConnectorSettingsChanges', () => {
  it('reports no changes for an untouched draft', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'a@tsh.io' },
        { key: 'apiKey', secret: true, required: true, source: 'stored' },
      ],
    });

    const draft = createConnectorSettingsDraft(connector);

    expect(hasConnectorSettingsChanges(draft)).toBe(false);
  });

  it('reports a change once a field is edited', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'a@tsh.io' },
      ],
    });

    const draft = createConnectorSettingsDraft(connector);
    draft.fields[0].value = 'b@tsh.io';

    expect(hasConnectorSettingsChanges(draft)).toBe(true);
  });
});

describe('canSubmitConnectorSettings', () => {
  it('refuses submission when nothing has changed', () => {
    const connector = createConnector({
      settings: [{ key: 'password', secret: true, required: true, source: 'stored' }],
    });

    const draft = createConnectorSettingsDraft(connector);

    expect(canSubmitConnectorSettings(draft)).toBe(false);
  });

  it('allows submission once a non-secret field is edited, even with a blank stored secret box', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: false, source: 'stored', value: 'a@tsh.io' },
        { key: 'apiKey', secret: true, required: true, source: 'stored' },
      ],
    });

    const draft = createConnectorSettingsDraft(connector);
    draft.fields[0].value = 'b@tsh.io';

    expect(canSubmitConnectorSettings(draft)).toBe(true);
  });

  it('allows submission when a key is removed', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [],
      removedKeys: ['kycProvider.token'],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(true);
  });

  it('refuses a custom key row with a name but no value', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [{ name: 'kycProvider.token', value: '' }],
      removedKeys: [],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(false);
  });

  it('refuses a custom key row whose name collides with a declared field, since it would silently overwrite that field in the changes map', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'from',
          secret: false,
          required: true,
          source: 'stored',
          value: 'a@tsh.io',
          initialValue: 'a@tsh.io',
        },
      ],
      customKeys: [{ name: 'from', value: 'attacker@tsh.io' }],
      removedKeys: [],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(false);
  });

  it('refuses two custom key rows sharing the same name', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [
        { name: 'kycProvider.token', value: 'first' },
        { name: 'kycProvider.token', value: 'second' },
      ],
      removedKeys: [],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(false);
  });

  it('refuses submission when an untouched, fully blank custom key row is the only row present', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [{ name: '', value: '' }],
      removedKeys: [],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(false);
  });

  it('allows an untouched, fully blank custom key row to pass through unnoticed once something else changed', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [
        { name: '', value: '' },
        { name: 'kycProvider.token', value: 'shh' },
      ],
      removedKeys: [],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(true);
  });
});

describe('describeConnectorSettingsIssue', () => {
  const reasons: ConnectorSettingsIssueReason[] = [
    'undeclared_key',
    'missing_required_key',
    'invalid_value',
    'invalid_format',
    'missing_pairing',
    'would_be_dropped',
  ];

  it.each(reasons)('maps %s to a non-empty message', (reason) => {
    expect(describeConnectorSettingsIssue(reason).length).toBeGreaterThan(0);
  });

  it('maps every reason to a distinct message', () => {
    const messages = reasons.map((reason) => describeConnectorSettingsIssue(reason));

    expect(new Set(messages).size).toBe(reasons.length);
  });
});
