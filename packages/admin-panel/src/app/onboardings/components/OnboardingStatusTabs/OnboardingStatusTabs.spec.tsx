import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdminOnboardingFilters } from '../../utils/filter-admin-onboardings';
import { OnboardingStatusTabs } from './OnboardingStatusTabs';

const baseFilters: AdminOnboardingFilters = {
  status: '',
  workflowId: 'eu-kyc',
  workflowVersion: '',
  currentStep: '',
  onboardingId: '',
  parked: false,
  pendingConnectorId: '',
  parkedBefore: '',
  limit: 100,
};

function renderTabs(filters: AdminOnboardingFilters, total: number): void {
  render(
    <MemoryRouter>
      <OnboardingStatusTabs filters={filters} total={total} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('OnboardingStatusTabs', () => {
  it('marks All active with no status parameter, keeping other committed criteria', () => {
    renderTabs(baseFilters, 128);

    const all = screen.getByRole('link', { name: 'All 128' });
    expect(all).toHaveAttribute('aria-current', 'page');
    expect(all).toHaveAttribute('href', '/onboardings?workflowId=eu-kyc');

    expect(screen.getByRole('link', { name: 'Awaiting manual review' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it("sets a status tab's href to that status, resets the page, and keeps other committed criteria", () => {
    renderTabs(baseFilters, 128);

    const review = screen.getByRole('link', { name: 'Awaiting manual review' });
    expect(review).toHaveAttribute(
      'href',
      '/onboardings?status=awaiting_manual_review&workflowId=eu-kyc',
    );
  });

  it('shows a count only on the active tab', () => {
    renderTabs({ ...baseFilters, status: 'awaiting_manual_review' }, 68);

    expect(screen.getByRole('link', { name: 'Awaiting manual review 68' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'All' })).toHaveTextContent(/^All$/);
    expect(screen.getByRole('link', { name: 'Approved' })).toHaveTextContent(/^Approved$/);
  });
});
