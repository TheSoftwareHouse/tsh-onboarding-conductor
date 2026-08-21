import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorSettingsForm } from './ConnectorSettingsForm';
import type { ConnectorSettings } from '../types/connector-settings';

const SENDGRID: ConnectorSettings = {
  connectorType: 'sendgrid_email',
  label: 'SendGrid email',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      source: 'database',
      value: null,
    },
    {
      key: 'from',
      label: 'Sender address',
      secret: false,
      required: true,
      hint: 'Must be a verified SendGrid sender.',
      source: 'environment',
      value: 'ops@example.com',
    },
  ],
};

function renderForm(connector: ConnectorSettings = SENDGRID) {
  const onSave = vi.fn();
  render(
    <ConnectorSettingsForm
      connector={connector}
      disabled={false}
      statusMessage={null}
      onSave={onSave}
    />,
  );

  return { onSave };
}

afterEach(() => {
  cleanup();
});

describe('ConnectorSettingsForm', () => {
  it('shows where each value comes from, and never puts a stored secret in the input', () => {
    renderForm();

    const apiKey = screen.getByLabelText(/API key/);
    expect(apiKey).toHaveAttribute('type', 'password');
    expect(apiKey).toHaveValue('');
    expect(apiKey).toHaveAttribute('placeholder', 'Saved — leave blank to keep it');
    expect(screen.getByLabelText(/Sender address/)).toHaveValue('ops@example.com');
    expect(
      screen.getByText('From the engine environment · Must be a verified SendGrid sender.'),
    ).toBeInTheDocument();
  });

  it('offers nothing to save until something is edited', async () => {
    renderForm();

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/API key/), 'SG.rotated');

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('submits only the settings that were edited', async () => {
    const { onSave } = renderForm();

    await userEvent.type(screen.getByLabelText(/API key/), 'SG.rotated');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSave).toHaveBeenCalledWith({ apiKey: 'SG.rotated' });
  });

  it('discards edits without saving them', async () => {
    const { onSave } = renderForm();

    await userEvent.type(screen.getByLabelText(/Sender address/), '.uk');
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(screen.getByLabelText(/Sender address/)).toHaveValue('ops@example.com');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('clears a saved secret by submitting an empty value, and says so before saving', async () => {
    const { onSave } = renderForm();

    await userEvent.click(screen.getByRole('button', { name: 'Clear saved value' }));

    expect(screen.getByText('Saving removes the stored value.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSave).toHaveBeenCalledWith({ apiKey: '' });
  });

  it('warns about a required setting neither source supplies', () => {
    renderForm({
      ...SENDGRID,
      fields: [{ ...SENDGRID.fields[0], source: 'unset' }],
    });

    expect(screen.getByText('The connector cannot run until this is set.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear saved value' })).not.toBeInTheDocument();
  });
});
