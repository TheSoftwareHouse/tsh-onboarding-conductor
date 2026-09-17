import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretInput } from './SecretInput';

afterEach(() => {
  cleanup();
});

/**
 * `SecretInput` is controlled, so revealing is only observable once something owns the value and
 * feeds each keystroke back in — exactly what a connector card does around it.
 */
function SecretInputHarness({
  initialValue = '',
  placeholder,
  disabled = false,
}: {
  initialValue?: string;
  placeholder?: string;
  disabled?: boolean;
}): ReactElement {
  const [value, setValue] = useState(initialValue);

  return (
    <>
      <label htmlFor="api-key">apiKey</label>
      <SecretInput
        id="api-key"
        name="apiKey"
        label="apiKey"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={setValue}
      />
    </>
  );
}

describe('SecretInput', () => {
  it('masks the value and keeps the browser from remembering it', () => {
    render(<SecretInputHarness initialValue="sk-live" />);

    const input = screen.getByLabelText('apiKey');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveAttribute('name', 'apiKey');
  });

  it('shows what was typed on request and masks it again on the second click', async () => {
    const user = userEvent.setup();
    render(<SecretInputHarness />);

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
    render(<SecretInputHarness placeholder="••••••••••••" />);

    // A stored secret's box is always empty — the engine never returns the value. An enabled eye
    // here would promise a reveal that could only ever display the placeholder's bullets.
    expect(screen.getByRole('button', { name: 'Show apiKey' })).toBeDisabled();
    expect(screen.getByLabelText('apiKey')).toHaveAttribute('placeholder', '••••••••••••');
  });

  it('falls back to masked when a revealed box is emptied', async () => {
    const user = userEvent.setup();
    render(<SecretInputHarness initialValue="x" placeholder="••••••••••••" />);

    const input = screen.getByLabelText('apiKey');
    await user.click(screen.getByRole('button', { name: 'Show apiKey' }));
    await user.clear(input);

    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show apiKey' })).toBeDisabled();
  });

  it('disables the input and its toggle while a write is in flight', () => {
    render(<SecretInputHarness initialValue="sg-key" disabled />);

    expect(screen.getByLabelText('apiKey')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show apiKey' })).toBeDisabled();
  });

  it('marks a refused value and points at the text describing it', () => {
    render(
      <>
        <label htmlFor="api-key">apiKey</label>
        <SecretInput
          id="api-key"
          name="apiKey"
          label="apiKey"
          value=""
          disabled={false}
          invalid
          describedBy="api-key-hint api-key-error"
          onChange={vi.fn()}
        />
      </>,
    );

    const input = screen.getByLabelText('apiKey');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'api-key-hint api-key-error');
  });
});
