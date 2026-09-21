import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorSettingsWriteError } from '../../../api/admin-connectors';
import type { Connector, ConnectorSettingsIssue } from '../../../types/connector';
import { ConnectorCard, type ConnectorCardProps } from './ConnectorCard';

afterEach(() => {
  cleanup();
});

function createConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'sendgrid_email',
    type: 'email_delivery',
    name: 'SendGrid',
    configured: false,
    settings: [],
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function renderCard(
  connector: Connector,
  overrides: Partial<Omit<ConnectorCardProps, 'connector'>> = {},
) {
  const onSave = vi.fn().mockResolvedValue({ ok: true });
  const onClear = vi.fn().mockResolvedValue({ ok: true });

  const utils = render(
    <ConnectorCard connector={connector} onSave={onSave} onClear={onClear} {...overrides} />,
  );

  return { ...utils, onSave, onClear };
}

describe('ConnectorCard', () => {
  it('shows the id alongside the type when the id and name differ', () => {
    renderCard(createConnector({ id: 'smtp', name: 'Outbound SMTP', type: 'email_delivery' }));
    expect(screen.getByText('smtp · type email_delivery')).toBeInTheDocument();
  });

  it('drops the id token and keeps only the type when the id equals the name, so the subtitle does not repeat the heading', () => {
    renderCard(
      createConnector({ id: 'twilio_verify', name: 'twilio_verify', type: 'phone_verification' }),
    );
    expect(screen.getByText('type phone_verification')).toBeInTheDocument();
    expect(screen.queryByText('twilio_verify · type phone_verification')).not.toBeInTheDocument();
  });

  it('omits the "Updated … by …" line entirely when the connector has never been written', () => {
    renderCard(createConnector({ updatedAt: null, updatedBy: null }));

    expect(screen.queryByText(/^Updated/)).not.toBeInTheDocument();
  });

  it('renders the "Updated … by …" line once the connector has update history', () => {
    renderCard(createConnector({ updatedAt: '2026-01-15T10:30:00.000Z', updatedBy: 'ops@tsh.io' }));

    expect(screen.getByText(/^Updated/)).toHaveTextContent(/Updated .+ by ops@tsh\.io/);
  });

  it('disables its own controls while its save is in flight', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      settings: [{ key: 'host', secret: false, required: false, source: 'unset' }],
    });

    let settleSave: (outcome: { ok: true }) => void = () => {};
    const onSave = vi.fn().mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        settleSave = resolve;
      }),
    );

    renderCard(connector, { onSave });

    await user.type(screen.getByLabelText('host'), 'mail.example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByLabelText('host')).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear settings' })).toBeDisabled();

    settleSave({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clear settings' })).toBeEnabled();
    });
  });

  it('disables its own controls while its clear is in flight', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      configured: true,
      settings: [{ key: 'host', secret: false, required: false, source: 'stored', value: 'x' }],
    });

    let settleClear: (outcome: { ok: true }) => void = () => {};
    const onClear = vi.fn().mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        settleClear = resolve;
      }),
    );

    renderCard(connector, { onClear });

    await user.click(screen.getByRole('button', { name: 'Clear settings' }));
    await user.click(screen.getByRole('button', { name: 'Confirm clear' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clear settings' })).toBeDisabled();
    });
    expect(screen.getByLabelText('host')).toBeDisabled();

    settleClear({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clear settings' })).toBeEnabled();
    });
  });

  it('renders the destructive "Clear settings" action with the danger treatment', () => {
    const connector = createConnector({
      configured: true,
      settings: [{ key: 'host', secret: false, required: false, source: 'stored', value: 'x' }],
    });

    renderCard(connector);

    expect(screen.getByRole('button', { name: 'Clear settings' })).toHaveClass('text-tsh-red');
  });

  it('marks a stored secret two ways, since its empty box looks unset', () => {
    const connector = createConnector({
      settings: [{ key: 'apiKey', secret: true, required: true, source: 'stored' }],
    });

    renderCard(connector);

    const input = screen.getByLabelText('apiKey');
    expect(input).toHaveValue('');
    // A fixed-width mask: the engine never sends the length, so this must not imply one.
    expect(input).toHaveAttribute('placeholder', '••••••••••••');
    const hint = document.getElementById(input.getAttribute('aria-describedby') as string);
    expect(hint).toHaveTextContent('stored');
  });

  it('gives an unset secret no mask and no stored badge', () => {
    const connector = createConnector({
      settings: [{ key: 'apiKey', secret: true, required: true, source: 'unset' }],
    });

    renderCard(connector);

    const input = screen.getByLabelText('apiKey');
    expect(input).not.toHaveAttribute('placeholder');
    const hint = document.getElementById(input.getAttribute('aria-describedby') as string);
    expect(hint).toHaveTextContent('Not set');
    expect(hint).not.toHaveTextContent('stored');
  });

  it('renders a secret setting as an empty password field', () => {
    const connector = createConnector({
      settings: [{ key: 'apiKey', secret: true, required: true, source: 'stored' }],
    });

    renderCard(connector);

    const input = screen.getByLabelText('apiKey');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveValue('');
  });

  it('reveals a secret the operator has entered, so a pasted credential can be proof-read', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      settings: [{ key: 'apiKey', secret: true, required: true, source: 'stored' }],
    });

    renderCard(connector);

    const input = screen.getByLabelText('apiKey');
    // Nothing typed yet, and the engine never returns the stored value, so there is nothing the
    // eye could show — see `SecretFormField` for why it is disabled rather than misleading.
    expect(screen.getByRole('button', { name: 'Show apiKey' })).toBeDisabled();

    await user.type(input, 'sg-key');
    await user.click(screen.getByRole('button', { name: 'Show apiKey' }));

    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('sg-key');
  });

  it('prefills a non-secret stored value', () => {
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
      ],
    });

    renderCard(connector);

    const input = screen.getByLabelText('from');
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

    renderCard(connector);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('enables Save and submits only the edited key, leaving an untouched stored secret unsent', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      configured: true,
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
        { key: 'apiKey', secret: true, required: true, source: 'stored' },
      ],
    });

    const { onSave } = renderCard(connector);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    const fromInput = screen.getByLabelText('from');
    await user.clear(fromInput);
    await user.type(fromInput, 'ops@tsh.io');

    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ from: 'ops@tsh.io' });
  });

  it('submits only the key that changed when a stored secret is filled in', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
        { key: 'apiKey', secret: true, required: true, source: 'stored' },
      ],
    });

    const { onSave } = renderCard(connector);

    await user.type(screen.getByLabelText('apiKey'), 'sg-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ apiKey: 'sg-key' });
  });

  it('does not enable Save for a whitespace-only edit, since the comparison trims', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
      ],
    });

    renderCard(connector);

    const fromInput = screen.getByLabelText('from');
    await user.type(fromInput, '   ');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('resets a saved field to what was actually sent, leaving it clean for the next save', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
      ],
    });

    // The connector prop is deliberately left stale across the save — `saveSettings` does not
    // await its own refetch, so the card must not reset from it.
    renderCard(connector);

    const fromInput = screen.getByLabelText('from');
    await user.clear(fromInput);
    await user.type(fromInput, 'ops@tsh.io');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByDisplayValue('ops@tsh.io')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('empties every box once a clear succeeds', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      configured: true,
      settings: [
        { key: 'host', secret: false, required: true, source: 'stored', value: 'smtp.example.com' },
        { key: 'password', secret: true, required: true, source: 'stored' },
      ],
    });

    renderCard(connector);

    await user.click(screen.getByRole('button', { name: 'Clear settings' }));
    await user.click(screen.getByRole('button', { name: 'Confirm clear' }));

    expect(await screen.findByLabelText('host')).toHaveValue('');
  });

  it('requires a confirmation click before Clear fires', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      configured: true,
      settings: [{ key: 'host', secret: false, required: false, source: 'stored', value: 'x' }],
    });

    const { onClear } = renderCard(connector);

    await user.click(screen.getByRole('button', { name: 'Clear settings' }));
    expect(onClear).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm clear' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('cancels the clear confirmation without clearing anything', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      configured: true,
      settings: [{ key: 'host', secret: false, required: false, source: 'stored', value: 'x' }],
    });

    const { onClear } = renderCard(connector);

    await user.click(screen.getByRole('button', { name: 'Clear settings' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Clear settings' })).toBeInTheDocument();
  });

  it('renders a rejected write issue under its own field', async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      settings: [
        { key: 'from', secret: false, required: true, source: 'stored', value: 'noreply@tsh.io' },
      ],
    });
    const issues: ConnectorSettingsIssue[] = [{ key: 'from', reason: 'invalid_format' }];
    const onSave = vi.fn().mockResolvedValue({
      ok: false,
      error: new ConnectorSettingsWriteError('Rejected.', 400, issues),
    });

    renderCard(connector, { onSave });

    const fromInput = screen.getByLabelText('from');
    await user.clear(fromInput);
    await user.type(fromInput, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This value does not match the expected format.',
    );
    expect(fromInput).toHaveAttribute('aria-invalid', 'true');

    // `aria-describedby` is a token list: the state hint is always referenced, and the error joins
    // it when the write is refused, so a screen reader hears both.
    const describedBy = (fromInput.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean);
    expect(describedBy).toHaveLength(2);
  });

  it("shows a key's first reason, so a whole-map consequence never masks the refused value", async () => {
    const user = userEvent.setup();
    const connector = createConnector({
      settings: [{ key: 'from', secret: false, required: true, source: 'unset' }],
    });
    // Reason order is the engine's: the per-key finding first, whatever its absence then
    // implies second. `setError` replaces, so the loop must stop after the first.
    const issues: ConnectorSettingsIssue[] = [
      { key: 'from', reason: 'invalid_format' },
      { key: 'from', reason: 'missing_required_key' },
    ];
    const onSave = vi.fn().mockResolvedValue({
      ok: false,
      error: new ConnectorSettingsWriteError('Rejected.', 400, issues),
    });

    renderCard(connector, { onSave });

    await user.type(screen.getByLabelText('from'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This value does not match the expected format.',
    );
    expect(screen.queryByText('This setting is required.')).not.toBeInTheDocument();
  });

  it('adds a factual note when the connector is configured but nothing is stored', () => {
    const configuredEmpty = createConnector({
      configured: true,
      settings: [
        { key: 'host', secret: false, required: false, source: 'unset' },
        { key: 'port', secret: false, required: false, source: 'unset' },
      ],
    });

    const { unmount } = renderCard(configuredEmpty);
    expect(screen.getByText('No settings are stored for this connector.')).toBeInTheDocument();
    unmount();

    const configuredWithStoredValue = createConnector({
      configured: true,
      settings: [
        { key: 'host', secret: false, required: false, source: 'stored', value: 'smtp.tsh.io' },
        { key: 'port', secret: false, required: false, source: 'unset' },
      ],
    });

    renderCard(configuredWithStoredValue);
    expect(
      screen.queryByText('No settings are stored for this connector.'),
    ).not.toBeInTheDocument();
  });

  it('renders the no-settings card with no footer when the connector declares no settings', () => {
    const connector = createConnector({ configured: true, settings: [] });

    renderCard(connector);

    expect(screen.getByText('No settings')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This adapter declares no settings schema, so there is nothing to configure.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear settings' })).not.toBeInTheDocument();
  });

  it('reads a configured connector as "Configured"', () => {
    const connector = createConnector({
      configured: true,
      settings: [{ key: 'host', secret: false, required: false, source: 'stored', value: 'x' }],
    });

    renderCard(connector);
    expect(screen.getByText('Configured')).toBeInTheDocument();
  });

  it('reads an unconfigured connector as "Not configured"', () => {
    const connector = createConnector({
      configured: false,
      settings: [{ key: 'host', secret: false, required: false, source: 'unset' }],
    });

    renderCard(connector);
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });

  it('reads a connector with no settings schema as "No settings", regardless of configured', () => {
    renderCard(createConnector({ configured: true, settings: [] }));
    expect(screen.getByText('No settings')).toBeInTheDocument();
  });
});
