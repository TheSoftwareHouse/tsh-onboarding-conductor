import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { useForm, type UseControllerProps } from 'react-hook-form';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretFormField } from './SecretFormField';

afterEach(() => {
  cleanup();
});

interface TestFormValues {
  apiKey: string;
}

/**
 * `SecretFormField` reads and writes through `react-hook-form`, so this harness owns a real form —
 * the same relationship `ConnectorSettingField` has with `ConnectorCard`'s form. Passing `error`
 * seeds the form's own `errors`, since the field has no `error` prop of its own to drive from. A
 * `<form>` with a submit button lets a test drive `rules` through an actual submit.
 */
function SecretFormFieldHarness({
  defaultValue = '',
  placeholder,
  disabled = false,
  error,
  isRequired,
  rules,
  onSubmit,
}: {
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  isRequired?: boolean;
  rules?: UseControllerProps<TestFormValues>['rules'];
  onSubmit?: (values: TestFormValues) => void;
}): ReactElement {
  const { control, handleSubmit } = useForm<TestFormValues>({
    defaultValues: { apiKey: defaultValue },
    errors: error ? { apiKey: { type: 'manual', message: error } } : undefined,
  });

  return (
    <form onSubmit={onSubmit && handleSubmit(onSubmit)}>
      <SecretFormField
        control={control}
        name="apiKey"
        controlId="api-key"
        label="apiKey"
        revealLabel="apiKey"
        placeholder={placeholder}
        disabled={disabled}
        isRequired={isRequired}
        rules={rules}
      />
      <button type="submit">Submit</button>
    </form>
  );
}

describe('SecretFormField', () => {
  it('masks the value and keeps the browser from remembering it', () => {
    render(<SecretFormFieldHarness defaultValue="sk-live" />);

    const input = screen.getByLabelText('apiKey');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('data-1p-ignore');
    expect(input).toHaveAttribute('data-lpignore', 'true');
    expect(input).toHaveAttribute('data-bwignore');
    expect(input).toHaveAttribute('name', 'apiKey');
  });

  it('shows what was typed on request and masks it again on the second click', async () => {
    const user = userEvent.setup();
    render(<SecretFormFieldHarness />);

    const input = screen.getByLabelText('apiKey');
    await user.type(input, 'sg-key');

    // The toggle names the credential and the action, so the state is in its accessible name
    // rather than in an `aria-pressed` that could disagree with the label.
    await user.click(screen.getByRole('button', { name: 'Show apiKey' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('sg-key');

    await user.click(screen.getByRole('button', { name: 'Hide apiKey' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('offers no reveal while the box is empty, so a mask is never mistaken for the value', () => {
    render(<SecretFormFieldHarness placeholder="••••••••••••" />);

    // A stored secret's box is always empty — the engine never returns the value. An enabled eye
    // here would promise a reveal that could only ever display the placeholder's bullets.
    expect(screen.getByRole('button', { name: 'Show apiKey' })).toBeDisabled();
    expect(screen.getByLabelText('apiKey')).toHaveAttribute('placeholder', '••••••••••••');
  });

  it('falls back to masked when a revealed box is emptied', async () => {
    const user = userEvent.setup();
    render(<SecretFormFieldHarness defaultValue="x" placeholder="••••••••••••" />);

    const input = screen.getByLabelText('apiKey');
    await user.click(screen.getByRole('button', { name: 'Show apiKey' }));
    await user.clear(input);

    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show apiKey' })).toBeDisabled();
  });

  it('disables the input and its toggle while a write is in flight', () => {
    render(<SecretFormFieldHarness defaultValue="sg-key" disabled />);

    expect(screen.getByLabelText('apiKey')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show apiKey' })).toBeDisabled();
  });

  it('surfaces the field error from form state and describes the input by both ids', () => {
    render(<SecretFormFieldHarness error="Value refused" />);

    const input = screen.getByLabelText('apiKey');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'api-key-hint api-key-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Value refused');
  });

  it('sets aria-required only when isRequired is set', () => {
    const { unmount } = render(<SecretFormFieldHarness isRequired />);
    expect(screen.getByLabelText('apiKey')).toHaveAttribute('aria-required', 'true');
    unmount();

    render(<SecretFormFieldHarness />);
    expect(screen.getByLabelText('apiKey')).not.toHaveAttribute('aria-required');
  });

  it('declaring isRequired alone does not block submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SecretFormFieldHarness isRequired onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toEqual({ apiKey: '' });
  });

  it('blocks submission through a supplied rules validator', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const rules: UseControllerProps<TestFormValues>['rules'] = {
      validate: (value: string) => value.trim().length > 0 || 'This setting is required.',
    };
    render(<SecretFormFieldHarness rules={rules} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This setting is required.');
  });

  it('does not crash reading .length when mounted on a name absent from defaultValues', () => {
    // `apiKey` is cast onto a form whose `defaultValues` never declared it, the same shape a
    // future caller would produce by mounting on an untracked name — `field.value` is `undefined`
    // rather than `''`.
    function MissingDefaultValueHarness(): ReactElement {
      const { control } = useForm<TestFormValues>({ defaultValues: {} as TestFormValues });
      return (
        <SecretFormField
          control={control}
          name="apiKey"
          controlId="api-key"
          label="apiKey"
          revealLabel="apiKey"
        />
      );
    }

    render(<MissingDefaultValueHarness />);

    expect(screen.getByLabelText('apiKey')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Show apiKey' })).toBeDisabled();
  });
});
