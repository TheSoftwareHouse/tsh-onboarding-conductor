import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextFilterField } from './TextFilterField';

afterEach(() => {
  cleanup();
});

describe('TextFilterField', () => {
  it('labels the input and reports what was typed', async () => {
    const onChange = vi.fn();
    render(
      <TextFilterField
        id="workflow-id-filter"
        name="workflowId"
        label="Workflow ID"
        value=""
        disabled={false}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText('Workflow ID');
    expect(input).toHaveAttribute('name', 'workflowId');
    expect(input).not.toHaveAttribute('aria-invalid');

    // The control is owned by the caller, so each keystroke reports the value it would produce
    // from the value passed in rather than an accumulated one.
    await userEvent.type(input, 'k');

    expect(onChange).toHaveBeenLastCalledWith('k');
  });

  it('bounds the value the endpoint would refuse and hints the keyboard for a numeric criterion', () => {
    render(
      <TextFilterField
        id="workflow-version-filter"
        name="workflowVersion"
        label="Workflow version"
        value="2"
        disabled={false}
        maxLength={64}
        inputMode="numeric"
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Workflow version');
    expect(input).toHaveAttribute('maxlength', '64');
    expect(input).toHaveAttribute('inputmode', 'numeric');
  });

  it('marks a refused value and points it at the panel message', () => {
    render(
      <TextFilterField
        id="workflow-version-filter"
        name="workflowVersion"
        label="Workflow version"
        value="abc"
        disabled={false}
        describedBy="workflow-version-error"
        invalid
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Workflow version');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'workflow-version-error');
  });
});
