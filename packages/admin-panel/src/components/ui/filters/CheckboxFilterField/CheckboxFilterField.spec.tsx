import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckboxFilterField } from './CheckboxFilterField';

afterEach(() => {
  cleanup();
});

describe('CheckboxFilterField', () => {
  it('labels the group above the checkbox and the checkbox by its inline text', () => {
    render(
      <CheckboxFilterField
        id="has-draft-filter"
        name="hasDraft"
        label="Drafts"
        value={false}
        disabled={false}
        onChange={vi.fn()}
      >
        Has unpublished draft
      </CheckboxFilterField>,
    );

    expect(screen.getByText('Drafts')).toBeInTheDocument();
    const checkbox = screen.getByLabelText('Has unpublished draft');
    expect(checkbox).toHaveAttribute('name', 'hasDraft');
    expect(checkbox).not.toBeChecked();
  });

  it('reports the toggled value on click, from either the box or its inline text', async () => {
    const onChange = vi.fn();
    render(
      <CheckboxFilterField
        id="has-draft-filter"
        name="hasDraft"
        label="Drafts"
        value={false}
        disabled={false}
        onChange={onChange}
      >
        Has unpublished draft
      </CheckboxFilterField>,
    );

    await userEvent.click(screen.getByText('Has unpublished draft'));

    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('shows the value the caller holds as checked', () => {
    render(
      <CheckboxFilterField
        id="has-draft-filter"
        name="hasDraft"
        label="Drafts"
        value
        disabled={false}
        onChange={vi.fn()}
      >
        Has unpublished draft
      </CheckboxFilterField>,
    );

    expect(screen.getByLabelText('Has unpublished draft')).toBeChecked();
  });

  it('blocks toggling while disabled', () => {
    render(
      <CheckboxFilterField
        id="has-draft-filter"
        name="hasDraft"
        label="Drafts"
        value={false}
        disabled
        onChange={vi.fn()}
      >
        Has unpublished draft
      </CheckboxFilterField>,
    );

    expect(screen.getByLabelText('Has unpublished draft')).toBeDisabled();
  });

  it('marks a refused value and points it at the panel message', () => {
    render(
      <CheckboxFilterField
        id="has-draft-filter"
        name="hasDraft"
        label="Drafts"
        value={false}
        disabled={false}
        describedBy="workflows-filter-error"
        invalid
        onChange={vi.fn()}
      >
        Has unpublished draft
      </CheckboxFilterField>,
    );

    const checkbox = screen.getByLabelText('Has unpublished draft');
    expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect(checkbox).toHaveAttribute('aria-describedby', 'workflows-filter-error');
  });
});
