import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchInput } from './SearchInput';

afterEach(() => {
  cleanup();
});

describe('SearchInput', () => {
  it('is reachable by its accessible name and reports what was typed', async () => {
    const onChange = vi.fn();
    render(<SearchInput label="Onboarding ID" value="" onChange={onChange} onSubmit={vi.fn()} />);

    const input = screen.getByRole('searchbox', { name: 'Onboarding ID' });

    await userEvent.type(input, 'a');

    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('submits exactly once on Enter', async () => {
    const onSubmit = vi.fn();
    render(
      <SearchInput label="Onboarding ID" value="01a" onChange={vi.fn()} onSubmit={onSubmit} />,
    );

    await userEvent.type(screen.getByRole('searchbox', { name: 'Onboarding ID' }), '{Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('blocks typing and submitting while disabled', async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <SearchInput
        label="Onboarding ID"
        value=""
        disabled
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByRole('searchbox', { name: 'Onboarding ID' });
    expect(input).toBeDisabled();

    await userEvent.type(input, 'a{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
