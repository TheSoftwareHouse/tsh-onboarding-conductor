import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormField, fieldDescribedBy, fieldIds } from './FormField';

afterEach(() => {
  cleanup();
});

describe('fieldIds', () => {
  it('derives the hint and error ids from the control id', () => {
    expect(fieldIds('api-key')).toEqual({ hintId: 'api-key-hint', errorId: 'api-key-error' });
  });
});

describe('fieldDescribedBy', () => {
  it('always includes the hint, appending the error id only once one exists', () => {
    expect(fieldDescribedBy('api-key', false)).toBe('api-key-hint');
    expect(fieldDescribedBy('api-key', true)).toBe('api-key-hint api-key-error');
  });
});

describe('FormField', () => {
  it('labels the control, places badges inline and carries the hint id on the trailing wrapper', () => {
    render(
      <FormField
        controlId="api-key"
        label="apiKey"
        badges={<span>required</span>}
        trailing={<span>Not set</span>}
      >
        <input id="api-key" />
      </FormField>,
    );

    const label = screen.getByText('apiKey');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'api-key');
    expect(screen.getByText('required')).toBeInTheDocument();

    // A caller never attaches the hint id itself — the layout owns it on the wrapper it renders.
    const trailing = screen.getByText('Not set');
    expect(trailing.parentElement).toHaveAttribute('id', 'api-key-hint');
    expect(trailing.parentElement).toHaveClass('ml-auto', 'flex', 'items-center');
  });

  it('renders the required chip before badges, so it is always first', () => {
    render(
      <FormField controlId="api-key" label="apiKey" isRequired badges={<span>secret</span>}>
        <input id="api-key" />
      </FormField>,
    );

    const labelRow = screen.getByText('apiKey').parentElement;
    const chipTexts = Array.from(labelRow?.querySelectorAll('span') ?? []).map(
      (span) => span.textContent,
    );
    expect(chipTexts.indexOf('required')).toBeLessThan(chipTexts.indexOf('secret'));
  });

  it('renders no required chip when isRequired is not set', () => {
    render(
      <FormField controlId="api-key" label="apiKey">
        <input id="api-key" />
      </FormField>,
    );

    expect(screen.queryByText('required')).not.toBeInTheDocument();
  });

  it('renders no error line when none is passed', () => {
    render(
      <FormField controlId="api-key" label="apiKey">
        <input id="api-key" />
      </FormField>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the error with role="alert" and its own id', () => {
    render(
      <FormField controlId="api-key" label="apiKey" error="Value refused">
        <input id="api-key" />
      </FormField>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('id', 'api-key-error');
    expect(alert).toHaveClass('text-body-sm', 'text-tsh-red');
    expect(alert).toHaveTextContent('Value refused');
  });
});
