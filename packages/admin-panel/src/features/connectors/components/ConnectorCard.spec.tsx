import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connector, ConnectorSettingsIssue } from '../types/connector';
import { createConnectorSettingsDraft } from '../utils/connector-settings-form';
import { ConnectorCard } from './ConnectorCard';

afterEach(() => {
  cleanup();
});

function createConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'sendgrid_email',
    type: 'email_delivery',
    name: 'SendGrid',
    configured: false,
    allowAdditionalKeys: false,
    settings: [],
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

/**
 * `ConnectorCard` is a controlled form: the draft it renders and every mutation to it come from
 * props. This harness plays the part `AdminConnectorsPage` (Task 3.2) will — owning the draft
 * state and wiring it back through the same callbacks — so the card can be exercised the way an
 * operator actually would, one keystroke and click at a time.
 */
function ConnectorCardHarness({
  connector,
  issues = [],
  pending = false,
  onSave = vi.fn(),
  onClear = vi.fn(),
}: {
  connector: Connector;
  issues?: ConnectorSettingsIssue[];
  pending?: boolean;
  onSave?: (changes: Record<string, string | null>) => void;
  onClear?: () => void;
}): ReactElement {
  const [draft, setDraft] = useState(() => createConnectorSettingsDraft(connector));

  return (
    <ConnectorCard
      connector={connector}
      draft={draft}
      issues={issues}
      pending={pending}
      onFieldChange={(key, value) =>
        setDraft((prev) => ({
          ...prev,
          fields: prev.fields.map((field) => (field.key === key ? { ...field, value } : field)),
        }))
      }
      onRemoveField={(key) =>
        setDraft((prev) => ({
          ...prev,
          fields: prev.fields.filter((field) => field.key !== key),
          removedKeys: [...prev.removedKeys, key],
        }))
      }
      onAddCustomKey={() =>
        setDraft((prev) => ({
          ...prev,
          customKeys: [...prev.customKeys, { name: '', value: '' }],
        }))
      }
      onCustomKeyNameChange={(index, name) =>
        setDraft((prev) => ({
          ...prev,
          customKeys: prev.customKeys.map((key, i) => (i === index ? { ...key, name } : key)),
        }))
      }
      onCustomKeyValueChange={(index, value) =>
        setDraft((prev) => ({
          ...prev,
          customKeys: prev.customKeys.map((key, i) => (i === index ? { ...key, value } : key)),
        }))
      }
      onRemoveCustomKey={(index) =>
        setDraft((prev) => ({
          ...prev,
          customKeys: prev.customKeys.filter((_, i) => i !== index),
        }))
      }
      onSave={onSave}
      onClear={onClear}
    />
  );
}

describe('ConnectorCard', () => {
  it('shows the id under a name that differs from it, and not when the two match', () => {
    // No shipped adapter names itself differently today, but the port allows it and an operator
    // would still need the real id, so the component keeps handling it.
    const { unmount } = render(
      <ConnectorCardHarness connector={createConnector({ id: 'smtp', name: 'Outbound SMTP' })} />,
    );
    expect(screen.getByText('smtp')).toBeInTheDocument();
    unmount();

    // Most adapters name themselves after their id; repeating it twice is noise.
    render(
      <ConnectorCardHarness
        connector={createConnector({ id: 'twilio_verify', name: 'twilio_verify' })}
      />,
    );
    expect(screen.getAllByText('twilio_verify')).toHaveLength(1);
  });

  it('marks a stored secret two ways, since its empty box looks unset', () => {
    const connector = createConnector({
      settings: [{ key: 'apiKey', secret: true, required: true, source: 'stored' }],
    });

    render(<ConnectorCardHarness connector={connector} />);

    const input = screen.getByLabelText('apiKey (required, secret)');
    expect(input).toHaveValue('');
    // A fixed-width mask: the engine never sends the length, so this must not imply one.
    expect(input).toHaveAttribute('placeholder', '••••••••••••');
    const hint = document.getElementById(input.getAttribute('aria-describedby') as string);
    expect(hint).toHaveTextContent('Stored');
  });

  it('gives an unset secret no mask and no stored pill', () => {
    const connector = createConnector({
      settings: [{ key: 'apiKey', secret: true, required: true, source: 'unset' }],
    });

    render(<ConnectorCardHarness connector={connector} />);

    const input = screen.getByLabelText('apiKey (required, secret)');
    expect(input).not.toHaveAttribute('placeholder');
    const hint = document.getElementById(input.getAttribute('aria-describedby') as string);
    expect(hint).toHaveTextContent('Not set.');
    expect(hint).not.toHaveTextContent('Stored');
  });

  it('renders a secret setting as an empty password field', () => {
    const connector = createConnector({
      settings: [{ key: 'apiKey', secret: true, required: true, source: 'stored' }],
    });

    render(<ConnectorCardHarness connector={connector} />);

    const input = screen.getByLabelText('apiKey (required, secret)');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveValue('');
  });

  it('reveals a secret the operator has entered, so a pasted credential can be proof-read', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      settings: [{ key: 'apiKey', secret: true, required: true, source: 'stored' }],
    });

    render(<ConnectorCardHarness connector={connector} />);

    const input = screen.getByLabelText('apiKey (required, secret)');
    // Nothing typed yet, and the engine never returns the stored value, so there is nothing the
    // eye could show — see `SecretInput` for why it is disabled rather than misleading.
    expect(screen.getByRole('button', { name: 'Show apiKey' })).toBeDisabled();

    await user.type(input, 'sg-key');
    await user.click(screen.getByRole('button', { name: 'Show apiKey' }));

    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('sg-key');
  });

  it("masks an additional key's value and reveals it on request", async () => {
    const user = userEvent.setup();
    const connector = createConnector({ id: 'http_request', allowAdditionalKeys: true });

    render(<ConnectorCardHarness connector={connector} />);

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    const row = screen.getByRole('group', { name: 'Additional key' });
    const value = within(row).getByLabelText('Key value');
    expect(value).toHaveAttribute('type', 'password');

    await user.type(value, 'shh');
    await user.click(within(row).getByRole('button', { name: 'Show the key value' }));

    expect(value).toHaveAttribute('type', 'text');
  });

  it('prefills a non-secret stored value', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
      ],
    });

    render(<ConnectorCardHarness connector={connector} />);

    const input = screen.getByLabelText('from (required)');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('noreply@tsh.io');
  });

  it('disables Save when nothing has changed', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
        { key: 'apiKey', secret: true, required: true, source: 'stored' },
      ],
    });

    render(<ConnectorCardHarness connector={connector} />);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('enables Save and submits only the edited key, leaving an untouched stored secret unsent', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const connector = createConnector({
      configured: true,
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
        { key: 'apiKey', secret: true, required: true, source: 'stored' },
      ],
    });

    render(<ConnectorCardHarness connector={connector} onSave={onSave} />);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    const fromInput = screen.getByLabelText('from (required)');
    await user.clear(fromInput);
    await user.type(fromInput, 'ops@tsh.io');

    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ from: 'ops@tsh.io' });
  });

  it('submits only the key that changed when a stored secret is filled in', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
        { key: 'apiKey', secret: true, required: true, source: 'stored' },
      ],
    });

    render(<ConnectorCardHarness connector={connector} onSave={onSave} />);

    await user.type(screen.getByLabelText('apiKey (required, secret)'), 'sg-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ apiKey: 'sg-key' });
  });

  it('removes a key and sends null for it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const connector = createConnector({
      id: 'http_request',
      type: 'custom',
      allowAdditionalKeys: true,
      settings: [{ key: 'kycProvider.token', secret: true, required: false, source: 'stored' }],
    });

    render(<ConnectorCardHarness connector={connector} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Remove key' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ 'kycProvider.token': null });
  });

  it('requires a confirmation click before Clear fires', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const connector = createConnector({ configured: true });

    render(<ConnectorCardHarness connector={connector} onClear={onClear} />);

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm clear' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('renders a rejected write issue under its own field', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'not-an-email' },
      ],
    });
    const issues: ConnectorSettingsIssue[] = [{ key: 'from', reason: 'invalid_format' }];

    render(<ConnectorCardHarness connector={connector} issues={issues} />);

    const input = screen.getByLabelText('from (required)');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    // `aria-describedby` is a token list: the state hint is always referenced, and the error joins
    // it when the write is refused, so a screen reader hears both.
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    expect(describedBy).toHaveLength(2);
    const described = describedBy.map((id) => document.getElementById(id)?.textContent ?? '');
    expect(described.join(' ')).toContain('This value does not match the expected format.');
    expect(described.join(' ')).toContain('Stored');
  });

  it('offers "Add key" only when the connector allows additional keys', () => {
    const withAdditionalKeys = createConnector({ id: 'http_request', allowAdditionalKeys: true });
    const { unmount } = render(<ConnectorCardHarness connector={withAdditionalKeys} />);
    expect(screen.getByRole('button', { name: 'Add key' })).toBeInTheDocument();
    unmount();

    const withoutAdditionalKeys = createConnector({ allowAdditionalKeys: false });
    render(<ConnectorCardHarness connector={withoutAdditionalKeys} />);
    expect(screen.queryByRole('button', { name: 'Add key' })).not.toBeInTheDocument();
  });

  it('labels every additional-key row "Key name", "Key value" and "Remove key" without a row number', async () => {
    const user = userEvent.setup();
    const connector = createConnector({ id: 'http_request', allowAdditionalKeys: true });

    render(<ConnectorCardHarness connector={connector} />);

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    await user.click(screen.getByRole('button', { name: 'Add key' }));

    const rows = screen.getAllByRole('group', { name: 'Additional key' });
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(within(row).getByLabelText('Key name')).toBeInTheDocument();
      expect(within(row).getByLabelText('Key value')).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'Remove key' })).toBeInTheDocument();
    }
  });

  it('sends a custom key/value pair through onSave under the name the operator typed', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const connector = createConnector({ id: 'http_request', allowAdditionalKeys: true });

    render(<ConnectorCardHarness connector={connector} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    const row = screen.getByRole('group', { name: 'Additional key' });
    await user.type(within(row).getByLabelText('Key name'), 'kycProvider.token');
    await user.type(within(row).getByLabelText('Key value'), 'shh');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ 'kycProvider.token': 'shh' });
  });

  it('adds a factual note when the connector is configured but nothing is stored', () => {
    const configuredEmpty = createConnector({
      configured: true,
      settings: [
        { key: 'host', secret: false, required: false, source: 'unset' },
        { key: 'port', secret: false, required: false, source: 'unset' },
      ],
    });

    const { unmount } = render(<ConnectorCardHarness connector={configuredEmpty} />);
    expect(screen.getByText('No settings are stored for this connector.')).toBeInTheDocument();
    unmount();

    const configuredWithStoredValue = createConnector({
      configured: true,
      settings: [
        { key: 'host', secret: false, required: false, source: 'stored', value: 'smtp.tsh.io' },
        { key: 'port', secret: false, required: false, source: 'unset' },
      ],
    });

    render(<ConnectorCardHarness connector={configuredWithStoredValue} />);
    expect(
      screen.queryByText('No settings are stored for this connector.'),
    ).not.toBeInTheDocument();
  });
});
