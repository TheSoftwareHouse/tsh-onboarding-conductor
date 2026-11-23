import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agreement } from '../../../utils/agreements';
import { StepAgreements } from './StepAgreements';

afterEach(cleanup);

const OTHER: Agreement = { key: 'other', step: 'elsewhere', acceptedWhen: 'ok' };
const TERMS: Agreement = { key: 'terms-accepted', step: 'agree', acceptedWhen: 'termsAccepted' };

function renderSection(
  agreements: Agreement[],
  fields: string[] | null = ['termsAccepted', 'marketingConsent'],
): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(
    <StepAgreements
      agreements={agreements}
      stepName="agree"
      fields={fields}
      readOnly={false}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('StepAgreements', () => {
  it('renders nothing for a step with no yes/no field and no agreement', () => {
    const { container } = render(
      <StepAgreements
        agreements={[OTHER]}
        stepName="agree"
        fields={[]}
        readOnly={false}
        onChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('tracks a field with a key from its name, keeping the other agreements', async () => {
    const onChange = renderSection([OTHER]);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: /termsAccepted/ }));

    expect(onChange).toHaveBeenCalledWith([OTHER, TERMS]);
  });

  it('untracks a field', async () => {
    const onChange = renderSection([TERMS, OTHER]);

    expect(screen.getByRole('checkbox', { name: /termsAccepted/ })).toBeChecked();
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /termsAccepted/ }));

    expect(onChange).toHaveBeenCalledWith([OTHER]);
  });

  it('writes a valid key and holds an invalid one with its reason', async () => {
    const user = userEvent.setup();
    const onChange = renderSection([TERMS, OTHER]);
    const key = screen.getByRole('textbox', { name: 'Agreement key for termsAccepted' });

    await user.type(key, 's');
    expect(onChange).toHaveBeenLastCalledWith([{ ...TERMS, key: 'terms-accepteds' }, OTHER]);

    onChange.mockClear();
    await user.type(key, 'X');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Use lowercase letters, digits and -');
    expect(key).toHaveAccessibleDescription('Use lowercase letters, digits and -');
  });

  it('shows an agreement on a field the step no longer stores, with a remove button', async () => {
    const onChange = renderSection([{ ...TERMS, acceptedWhen: 'gone' }], ['termsAccepted']);

    expect(screen.getByText('Not a stored yes/no field of this step.')).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Remove agreement terms-accepted' }));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
