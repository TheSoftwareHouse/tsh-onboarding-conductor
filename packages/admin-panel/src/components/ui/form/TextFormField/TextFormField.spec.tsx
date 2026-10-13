import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { useForm, type UseControllerProps } from 'react-hook-form';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextFormField } from './TextFormField';

afterEach(() => {
  cleanup();
});

interface TestFormValues {
  apiKey: string;
}

/**
 * `TextFormField` reads and writes through `react-hook-form`, so this harness owns a real form —
 * the same relationship `ConnectorSettingField` has with `ConnectorCard`'s form. Passing `error`
 * seeds the form's own `errors`, since the field has no `error` prop of its own to drive from. A
 * `<form>` with a submit button lets a test drive `rules` through an actual submit.
 */
function TextFormFieldHarness({
  defaultValue = '',
  disabled = false,
  autoComplete,
  error,
  isRequired,
  rules,
  onSubmit,
}: {
  defaultValue?: string;
  disabled?: boolean;
  autoComplete?: string;
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
      <TextFormField
        control={control}
        name="apiKey"
        controlId="api-key"
        label="apiKey"
        disabled={disabled}
        autoComplete={autoComplete}
        isRequired={isRequired}
        rules={rules}
      />
      <button type="submit">Submit</button>
    </form>
  );
}

describe('TextFormField', () => {
  it('labels the control and describes it by the hint alone when there is no error', () => {
    render(<TextFormFieldHarness />);

    const input = screen.getByLabelText('apiKey');
    expect(input).toHaveAttribute('aria-describedby', 'api-key-hint');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('surfaces the field error from form state, with no error prop of its own, describing it by both ids', () => {
    render(<TextFormFieldHarness error="Value refused" />);

    const input = screen.getByLabelText('apiKey');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'api-key-hint api-key-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Value refused');
  });

  it('writes typed input through to the form', async () => {
    const user = userEvent.setup();
    render(<TextFormFieldHarness />);

    const input = screen.getByLabelText('apiKey');
    await user.type(input, 'sk-live');

    expect(input).toHaveValue('sk-live');
  });

  it('disables the control while a write is in flight', () => {
    render(<TextFormFieldHarness defaultValue="sk-live" disabled />);

    expect(screen.getByLabelText('apiKey')).toBeDisabled();
  });

  it('forwards autoComplete, and leaves it to the browser when omitted', () => {
    const { unmount } = render(<TextFormFieldHarness autoComplete="off" />);
    expect(screen.getByLabelText('apiKey')).toHaveAttribute('autocomplete', 'off');
    unmount();

    render(<TextFormFieldHarness />);
    expect(screen.getByLabelText('apiKey')).not.toHaveAttribute('autocomplete');
  });

  it('sets aria-required only when isRequired is set', () => {
    const { unmount } = render(<TextFormFieldHarness isRequired />);
    expect(screen.getByLabelText('apiKey')).toHaveAttribute('aria-required', 'true');
    unmount();

    render(<TextFormFieldHarness />);
    expect(screen.getByLabelText('apiKey')).not.toHaveAttribute('aria-required');
  });

  it('declaring isRequired alone does not block submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TextFormFieldHarness isRequired onSubmit={onSubmit} />);

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
    render(<TextFormFieldHarness rules={rules} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This setting is required.');
  });

  it('does not warn about switching from uncontrolled to controlled when mounted on a name absent from defaultValues', async () => {
    // `apiKey` is cast onto a form whose `defaultValues` never declared it, the same shape a
    // future caller would produce by mounting on an untracked name — `field.value` is `undefined`
    // rather than `''`. Typing is what actually transitions `field.value` from `undefined` to a
    // real string, which is what triggers React's uncontrolled-to-controlled warning.
    function MissingDefaultValueHarness(): ReactElement {
      const { control } = useForm<TestFormValues>({ defaultValues: {} as TestFormValues });
      return <TextFormField control={control} name="apiKey" controlId="api-key" label="apiKey" />;
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();

    render(<MissingDefaultValueHarness />);
    const input = screen.getByLabelText('apiKey');
    expect(input).toHaveValue('');

    await user.type(input, 'x');

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
