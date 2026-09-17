import { describe, expect, it } from 'vitest';
import type { Connector, ConnectorSettingsIssueReason } from '../types/connector';
import {
  buildConnectorSettingsChanges,
  canSubmitConnectorSettings,
  clearConnectorSettingsDraft,
  createConnectorSettingsDraft,
  describeConnectorSettingsIssue,
  hasConnectorSettingsChanges,
  type ConnectorSettingsDraft,
} from './connector-settings-form';

function createConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'smtp',
    type: 'email_delivery',
    name: 'SMTP',
    configured: false,
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
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({});
  });

  it('trims whitespace from a field value before sending it', () => {
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
    };

    expect(buildConnectorSettingsChanges(draft)).toEqual({ from: 'a@tsh.io' });
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

describe('clearConnectorSettingsDraft', () => {
  it('empties every box and forgets what was stored', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'host',
          secret: false,
          required: true,
          source: 'stored',
          value: 'smtp.example.com',
          initialValue: 'smtp.example.com',
        },
        {
          key: 'password',
          secret: true,
          required: true,
          source: 'stored',
          value: 'typed-but-unsaved',
          initialValue: '',
        },
      ],
    };

    expect(clearConnectorSettingsDraft(draft)).toEqual({
      fields: [
        {
          key: 'host',
          secret: false,
          required: true,
          source: 'unset',
          value: '',
          initialValue: '',
        },
        {
          key: 'password',
          secret: true,
          required: true,
          source: 'unset',
          value: '',
          initialValue: '',
        },
      ],
    });
  });

  it('leaves nothing for the next Save to send', () => {
    const draft: ConnectorSettingsDraft = {
      fields: [
        {
          key: 'host',
          secret: false,
          required: true,
          source: 'stored',
          value: 'smtp.example.com',
          initialValue: 'smtp.example.com',
        },
      ],
    };

    // A cleared card must not queue a deletion for a key the clear already removed: `initialValue`
    // is emptied with `value`, so nothing reads as touched.
    expect(buildConnectorSettingsChanges(clearConnectorSettingsDraft(draft))).toEqual({});
  });
});
