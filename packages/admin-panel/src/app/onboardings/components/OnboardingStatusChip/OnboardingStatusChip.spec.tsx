import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OnboardingStatusChip } from './OnboardingStatusChip';

afterEach(() => {
  cleanup();
});

describe('OnboardingStatusChip', () => {
  it.each([
    ['awaiting_manual_review', 'Awaiting manual review', 'bg-tsh-yellow-400'],
    ['awaiting_user', 'Awaiting user', 'bg-tsh-blue-100'],
    ['approved', 'Approved', 'bg-tsh-black'],
    ['rejected', 'Rejected', 'border-tsh-red'],
    ['invalid', 'Invalid', 'border-tsh-red'],
  ])('renders %s as "%s" with its tone', (status, label, toneClass) => {
    render(<OnboardingStatusChip status={status} />);

    expect(screen.getByText(label)).toHaveClass(toneClass);
  });

  it('renders an unrecognised status as-is rather than blank', () => {
    render(<OnboardingStatusChip status="pending_review" />);

    expect(screen.getByText('pending_review')).toBeInTheDocument();
  });

  it('takes the header band’s status size, leaving the list’s rows on the default badge', () => {
    render(<OnboardingStatusChip status="approved" size="status" />);

    expect(screen.getByText('Approved')).toHaveClass('text-caps-tiny');
  });
});
