import { describe, expect, it } from 'vitest';
import type { Connector, ConnectorSettingsIssueReason } from '../types/connector';
import {
  buildConnectorSettingsPayload,
  canSubmitConnectorSettings,
  createConnectorSettingsDraft,
  describeConnectorSettingsIssue,
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
  it('prefills a non-secret stored value', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
      ],
    });

    const draft = createConnectorSettingsDraft(connector);

    expect(draft.fields).toEqual([
      { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
    ]);
  });

  it('leaves a stored secret input empty, since the engine never returns its value', () => {
    const connector = createConnector({
      settings: [{ key: 'password', secret: true, required: true, source: 'stored' }],
    });

    const draft = createConnectorSettingsDraft(connector);

    expect(draft.fields).toEqual([
      { key: 'password', secret: true, required: true, source: 'stored', value: '' },
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
      { key: 'from', secret: false, required: true, source: 'unset', value: '' },
      { key: 'apiKey', secret: true, required: true, source: 'unset', value: '' },
    ]);
  });

  it('starts with no custom key rows', () => {
    const draft = createConnectorSettingsDraft(createConnector());

    expect(draft.customKeys).toEqual([]);
  });
});

describe('buildConnectorSettingsPayload', () => {
  it('omits empty field and custom-key inputs', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'a@tsh.io' },
        { key: 'username', secret: false, required: false, source: 'unset', value: '' },
      ],
      customKeys: [
        { name: 'kycProvider.token', value: 'shh' },
        { name: '', value: '' },
      ],
    };

    expect(buildConnectorSettingsPayload(draft)).toEqual({
      from: 'a@tsh.io',
      'kycProvider.token': 'shh',
    });
  });

  it('trims whitespace from field and custom-key values before sending them', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        { key: 'from', secret: false, required: true, source: 'stored', value: '  a@tsh.io  ' },
      ],
      customKeys: [{ name: '  kycProvider.token  ', value: '  shh  ' }],
    };

    expect(buildConnectorSettingsPayload(draft)).toEqual({
      from: 'a@tsh.io',
      'kycProvider.token': 'shh',
    });
  });

  it('omits a whitespace-only input the same as an empty one', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [{ key: 'from', secret: false, required: true, source: 'stored', value: '   ' }],
      customKeys: [],
    };

    expect(buildConnectorSettingsPayload(draft)).toEqual({});
  });
});

describe('canSubmitConnectorSettings', () => {
  it('refuses submission while a stored secret input is empty', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [{ key: 'password', secret: true, required: true, source: 'stored', value: '' }],
      customKeys: [],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(false);
  });

  it('allows submission once the stored secret is re-entered', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        { key: 'password', secret: true, required: true, source: 'stored', value: 'new-secret' },
      ],
      customKeys: [],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(true);
  });

  it('allows submission when a secret input is empty but was never stored', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [{ key: 'password', secret: true, required: true, source: 'unset', value: '' }],
      customKeys: [],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(true);
  });

  it('refuses a custom key row with a name but no value', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [{ name: 'kycProvider.token', value: '' }],
    };

    expect(canSubmitConnectorSettings(draft)).toBe(false);
  });

  it('refuses a custom key row whose name collides with a declared field, since it would silently overwrite that field in the payload', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [{ key: 'from', secret: false, required: true, source: 'stored', value: 'a@tsh.io' }],
      customKeys: [{ name: 'from', value: 'attacker@tsh.io' }],
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
    };

    expect(canSubmitConnectorSettings(draft)).toBe(false);
  });

  it('allows an untouched, fully blank custom key row to pass through unnoticed', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [],
      customKeys: [{ name: '', value: '' }],
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
