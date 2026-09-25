import { describe, expect, it } from 'vitest';
import type { ConnectorSetting, ConnectorSettingsIssueReason } from '@/api/connectors/connectors';
import {
  buildConnectorSettingsChanges,
  buildConnectorSettingsDefaults,
  buildConnectorSettingsResetValues,
  describeConnectorSettingsIssue,
  hasConnectorSettingsChanges,
} from './connector-settings-form';

function createSetting(overrides: Partial<ConnectorSetting> = {}): ConnectorSetting {
  return {
    key: 'from',
    secret: false,
    required: true,
    source: 'stored',
    ...overrides,
  };
}

describe('buildConnectorSettingsDefaults', () => {
  it('prefills a non-secret stored value', () => {
    const settings = [createSetting({ key: 'from', source: 'stored', value: 'noreply@tsh.io' })];

    expect(buildConnectorSettingsDefaults(settings)).toEqual({ from: 'noreply@tsh.io' });
  });

  it('leaves a stored secret empty, since the engine never returns its value', () => {
    const settings = [createSetting({ key: 'password', secret: true, source: 'stored' })];

    expect(buildConnectorSettingsDefaults(settings)).toEqual({ password: '' });
  });

  it('leaves an unset setting empty regardless of secrecy', () => {
    const settings = [
      createSetting({ key: 'from', secret: false, source: 'unset' }),
      createSetting({ key: 'apiKey', secret: true, source: 'unset' }),
    ];

    expect(buildConnectorSettingsDefaults(settings)).toEqual({ from: '', apiKey: '' });
  });
});

describe('buildConnectorSettingsChanges', () => {
  it('omits an untouched blank stored secret entirely', () => {
    const settings = [createSetting({ key: 'apiKey', secret: true, source: 'stored' })];

    expect(buildConnectorSettingsChanges({ apiKey: '' }, { apiKey: '' }, settings)).toEqual({});
  });

  it('sends a stored secret the operator typed into', () => {
    const settings = [createSetting({ key: 'apiKey', secret: true, source: 'stored' })];

    expect(
      buildConnectorSettingsChanges({ apiKey: 'new-secret' }, { apiKey: '' }, settings),
    ).toEqual({
      apiKey: 'new-secret',
    });
  });

  it('sends null for a non-secret stored value the operator emptied', () => {
    const settings = [createSetting({ key: 'from', secret: false, source: 'stored' })];

    expect(
      buildConnectorSettingsChanges({ from: '' }, { from: 'noreply@tsh.io' }, settings),
    ).toEqual({ from: null });
  });

  it('omits an emptied secret box rather than treating it as a deletion', () => {
    const settings = [createSetting({ key: 'apiKey', secret: true, source: 'stored' })];

    expect(
      buildConnectorSettingsChanges({ apiKey: '' }, { apiKey: 'was-typed-then-cleared' }, settings),
    ).toEqual({});
  });

  it('omits a field that was never stored and is left blank', () => {
    const settings = [createSetting({ key: 'from', secret: false, source: 'unset' })];

    expect(buildConnectorSettingsChanges({ from: '' }, { from: '' }, settings)).toEqual({});
  });

  it('omits a field edited back to its original text', () => {
    const settings = [createSetting({ key: 'from', secret: false, source: 'stored' })];

    expect(
      buildConnectorSettingsChanges(
        { from: '  noreply@tsh.io  ' },
        { from: 'noreply@tsh.io' },
        settings,
      ),
    ).toEqual({});
  });

  it('trims whitespace from a field value before sending it', () => {
    const settings = [createSetting({ key: 'from', secret: false, source: 'stored' })];

    expect(
      buildConnectorSettingsChanges({ from: '  a@tsh.io  ' }, { from: 'old@tsh.io' }, settings),
    ).toEqual({ from: 'a@tsh.io' });
  });
});

describe('hasConnectorSettingsChanges', () => {
  it('reports no changes for an untouched form', () => {
    const settings = [
      createSetting({ key: 'from', secret: false, source: 'stored', value: 'a@tsh.io' }),
      createSetting({ key: 'apiKey', secret: true, source: 'stored' }),
    ];
    const defaults = buildConnectorSettingsDefaults(settings);

    expect(hasConnectorSettingsChanges(defaults, defaults, settings)).toBe(false);
  });

  it('reports a change once a field is edited', () => {
    const settings = [
      createSetting({ key: 'from', secret: false, source: 'stored', value: 'a@tsh.io' }),
    ];
    const defaults = buildConnectorSettingsDefaults(settings);

    expect(hasConnectorSettingsChanges({ from: 'b@tsh.io' }, defaults, settings)).toBe(true);
  });

  it('refuses submission when nothing has changed', () => {
    const settings = [createSetting({ key: 'password', secret: true, source: 'stored' })];
    const defaults = buildConnectorSettingsDefaults(settings);

    expect(hasConnectorSettingsChanges(defaults, defaults, settings)).toBe(false);
  });

  it('allows submission once a non-secret field is edited, even with a blank stored secret box', () => {
    const settings = [
      createSetting({ key: 'from', secret: false, source: 'stored', value: 'a@tsh.io' }),
      createSetting({ key: 'apiKey', secret: true, source: 'stored' }),
    ];
    const defaults = buildConnectorSettingsDefaults(settings);

    expect(hasConnectorSettingsChanges({ ...defaults, from: 'b@tsh.io' }, defaults, settings)).toBe(
      true,
    );
  });
});

describe('buildConnectorSettingsResetValues', () => {
  it('resets a secret to empty and a non-secret to the trimmed value that was sent', () => {
    const settings = [
      createSetting({ key: 'host', secret: false, source: 'stored' }),
      createSetting({ key: 'password', secret: true, source: 'stored' }),
    ];

    expect(
      buildConnectorSettingsResetValues(
        { host: '  smtp.example.com  ', password: 'typed-but-unsaved' },
        settings,
      ),
    ).toEqual({ host: 'smtp.example.com', password: '' });
  });

  it('empties every box when given no values, which is what a successful Clear resets to', () => {
    const settings = [
      createSetting({ key: 'host', secret: false, source: 'stored' }),
      createSetting({ key: 'password', secret: true, source: 'stored' }),
    ];

    expect(buildConnectorSettingsResetValues({}, settings)).toEqual({ host: '', password: '' });
  });

  it('leaves nothing for the next Save to send once adopted as the new defaults', () => {
    const settings = [createSetting({ key: 'host', secret: false, source: 'stored' })];
    const reset = buildConnectorSettingsResetValues({ host: 'smtp.example.com' }, settings);

    // A save's own reset becomes the form's new defaultValues, so comparing the reset values
    // against themselves must queue nothing — this is what stops a just-saved field from
    // re-appearing as dirty.
    expect(buildConnectorSettingsChanges(reset, reset, settings)).toEqual({});
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
