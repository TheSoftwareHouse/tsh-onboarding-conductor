import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorSetting } from '@/api/connectors/connectors';
import {
  describeConnectorSettingsIssue,
  type ConnectorSettingsFormValues,
} from '../../../../utils/connector-settings-form';
import { ConnectorSettingField } from './ConnectorSettingField';

afterEach(() => {
  cleanup();
});

function createSetting(overrides: Partial<ConnectorSetting> = {}): ConnectorSetting {
  return {
    key: 'from',
    secret: false,
    required: false,
    source: 'unset',
    ...overrides,
  };
}

function ConnectorSettingFieldHarness({
  setting,
  error,
  disabled = false,
}: {
  setting: ConnectorSetting;
  error?: string;
  disabled?: boolean;
}): ReactElement {
  const { control } = useForm<ConnectorSettingsFormValues>({
    defaultValues: { [setting.key]: setting.secret ? '' : (setting.value ?? '') },
    errors: error ? { [setting.key]: { type: 'manual', message: error } } : undefined,
  });

  return (
    <ConnectorSettingField
      idPrefix="connector-test"
      setting={setting}
      control={control}
      disabled={disabled}
    />
  );
}

/** Wraps the field in a real `<form>` so a test can drive its enforcement through an actual submit. */
function ConnectorSettingFieldFormHarness({
  setting,
  onSubmit,
}: {
  setting: ConnectorSetting;
  onSubmit: (values: ConnectorSettingsFormValues) => void;
}): ReactElement {
  const { control, handleSubmit } = useForm<ConnectorSettingsFormValues>({
    defaultValues: { [setting.key]: setting.secret ? '' : (setting.value ?? '') },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <ConnectorSettingField
        idPrefix="connector-test"
        setting={setting}
        control={control}
        disabled={false}
      />
      <button type="submit">Submit</button>
    </form>
  );
}

describe('ConnectorSettingField', () => {
  it('shows the required badge only when the setting requires it', () => {
    const { unmount } = render(
      <ConnectorSettingFieldHarness setting={createSetting({ required: true })} />,
    );
    expect(screen.getByText('required')).toBeInTheDocument();
    unmount();

    render(<ConnectorSettingFieldHarness setting={createSetting({ required: false })} />);
    expect(screen.queryByText('required')).not.toBeInTheDocument();
  });

  it('shows the secret badge only when the setting is a secret', () => {
    const { unmount } = render(
      <ConnectorSettingFieldHarness setting={createSetting({ secret: true, source: 'stored' })} />,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
    unmount();

    render(<ConnectorSettingFieldHarness setting={createSetting({ secret: false })} />);
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('reads the secret badge in full-contrast black, not the grey `neutral` tone', () => {
    render(
      <ConnectorSettingFieldHarness setting={createSetting({ secret: true, source: 'stored' })} />,
    );

    const badge = screen.getByText('secret');
    expect(badge).toHaveClass('bg-bg-alt', 'text-tsh-black');
    expect(badge).not.toHaveClass('text-fg-2');
  });

  it('shows the stored badge and a masked placeholder for a stored field', () => {
    render(
      <ConnectorSettingFieldHarness
        setting={createSetting({ key: 'apiKey', secret: true, source: 'stored' })}
      />,
    );

    expect(screen.getByText('stored')).toBeInTheDocument();
    expect(screen.getByLabelText('apiKey')).toHaveAttribute('placeholder', '••••••••••••');
  });

  it('shows "Not set" and no placeholder for an unset field', () => {
    render(
      <ConnectorSettingFieldHarness setting={createSetting({ key: 'from', source: 'unset' })} />,
    );

    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.queryByText('stored')).not.toBeInTheDocument();
    expect(screen.getByLabelText('from')).not.toHaveAttribute('placeholder');
  });

  it('describes the input by the hint whether or not there is an error', () => {
    const { unmount } = render(
      <ConnectorSettingFieldHarness setting={createSetting({ key: 'from', source: 'stored' })} />,
    );
    const input = screen.getByLabelText('from');
    const describedByWithoutError = input.getAttribute('aria-describedby');
    expect(describedByWithoutError).toBeTruthy();
    expect(document.getElementById(describedByWithoutError as string)).not.toBeNull();
    unmount();

    render(
      <ConnectorSettingFieldHarness
        setting={createSetting({ key: 'from', source: 'stored' })}
        error="This value does not match the expected format."
      />,
    );
    const erroredInput = screen.getByLabelText('from');
    const describedByWithError = (erroredInput.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean);
    expect(describedByWithError).toHaveLength(2);
  });

  it('renders an error with role="alert"', () => {
    render(
      <ConnectorSettingFieldHarness
        setting={createSetting({ key: 'from', source: 'stored' })}
        error="This value does not match the expected format."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This value does not match the expected format.',
    );
    expect(screen.getByLabelText('from')).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables the input while a write is in flight', () => {
    render(<ConnectorSettingFieldHarness setting={createSetting()} disabled />);

    expect(screen.getByLabelText('from')).toBeDisabled();
  });

  describe('required enforcement', () => {
    it('does not block submit for a required stored field left empty, since the engine evaluates it against the merged result', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <ConnectorSettingFieldFormHarness
          setting={createSetting({
            key: 'apiKey',
            secret: true,
            required: true,
            source: 'stored',
          })}
          onSubmit={onSubmit}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Submit' }));

      expect(onSubmit).toHaveBeenCalledOnce();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('blocks submit for a required unset field left empty', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <ConnectorSettingFieldFormHarness
          setting={createSetting({ key: 'from', required: true, source: 'unset' })}
          onSubmit={onSubmit}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Submit' }));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        describeConnectorSettingsIssue('missing_required_key'),
      );
    });

    it('blocks submit for a required unset field filled with only whitespace, since the trim would omit it from the payload', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <ConnectorSettingFieldFormHarness
          setting={createSetting({ key: 'from', required: true, source: 'unset' })}
          onSubmit={onSubmit}
        />,
      );

      await user.type(screen.getByLabelText('from'), '   ');
      await user.click(screen.getByRole('button', { name: 'Submit' }));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        describeConnectorSettingsIssue('missing_required_key'),
      );
    });

    it('sets aria-required on both a required stored and a required unset field', () => {
      const { unmount } = render(
        <ConnectorSettingFieldHarness
          setting={createSetting({ key: 'apiKey', secret: true, required: true, source: 'stored' })}
        />,
      );
      expect(screen.getByLabelText('apiKey')).toHaveAttribute('aria-required', 'true');
      unmount();

      render(
        <ConnectorSettingFieldHarness
          setting={createSetting({ key: 'from', required: true, source: 'unset' })}
        />,
      );
      expect(screen.getByLabelText('from')).toHaveAttribute('aria-required', 'true');
    });
  });
});
