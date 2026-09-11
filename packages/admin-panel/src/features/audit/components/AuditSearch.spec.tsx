import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditSearch } from './AuditSearch';

afterEach(() => {
  cleanup();
});

describe('AuditSearch', () => {
  it('is reachable by "Resource ID" and seeded from the value it is given', () => {
    render(<AuditSearch value="01a" onSubmit={vi.fn()} />);

    expect(screen.getByRole('searchbox', { name: 'Resource ID' })).toHaveValue('01a');
  });

  it('calls back on Enter with the trimmed draft', async () => {
    const onSubmit = vi.fn();
    render(<AuditSearch value="" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Resource ID' }), '  01a  {Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('01a');
  });

  it('blocks submitting while disabled', async () => {
    const onSubmit = vi.fn();
    render(<AuditSearch value="01a" disabled onSubmit={onSubmit} />);

    const input = screen.getByRole('searchbox', { name: 'Resource ID' });
    expect(input).toBeDisabled();

    await userEvent.type(input, '{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
