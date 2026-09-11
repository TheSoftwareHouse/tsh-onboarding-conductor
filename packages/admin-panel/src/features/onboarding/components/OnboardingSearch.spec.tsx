import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingSearch } from './OnboardingSearch';

afterEach(() => {
  cleanup();
});

describe('OnboardingSearch', () => {
  it('is reachable by "Onboarding ID" and seeded from the value it is given', () => {
    render(<OnboardingSearch value="01a" onSubmit={vi.fn()} />);

    expect(screen.getByRole('searchbox', { name: 'Onboarding ID' })).toHaveValue('01a');
  });

  it('calls back on Enter with the trimmed draft', async () => {
    const onSubmit = vi.fn();
    render(<OnboardingSearch value="" onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Onboarding ID' }),
      '  01a  {Enter}',
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('01a');
  });
});
