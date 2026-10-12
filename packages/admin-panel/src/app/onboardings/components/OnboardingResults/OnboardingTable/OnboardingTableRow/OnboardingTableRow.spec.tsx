import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTime, formatNullableDateTime } from '@/lib/format-date-time';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import { OnboardingTableRow } from './OnboardingTableRow';

const RECORD: AdminOnboardingSummary = {
  onboardingId: '01a023ea-0000-7000-8000-0000000003dd1a',
  workflowId: 'eu-b2c-individual-kyc-eea',
  workflowVersion: 1,
  status: 'awaiting_manual_review',
  currentStep: 'manual_review',
  expiresAt: '2026-09-15T09:14:00.000Z',
  createdAt: '2026-08-31T09:14:00.000Z',
  updatedAt: '2026-09-02T09:14:00.000Z',
  completedAt: null,
  scores: {},
  pendingConnector: null,
};

function renderRow(initialPath: string): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <table>
        <tbody>
          <OnboardingTableRow record={RECORD} />
        </tbody>
      </table>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('OnboardingTableRow', () => {
  it("keeps the onboarding ID link's href carrying the current search string", () => {
    renderRow('/onboardings?status=awaiting_manual_review');

    expect(screen.getByRole('link', { name: RECORD.onboardingId })).toHaveAttribute(
      'href',
      `/onboardings/${RECORD.onboardingId}?status=awaiting_manual_review`,
    );
  });

  it('renders all four timestamps, including a null one as not-set', () => {
    renderRow('/onboardings');

    expect(screen.getByText(formatDateTime(RECORD.createdAt))).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(RECORD.updatedAt))).toBeInTheDocument();
    expect(screen.getByText(formatNullableDateTime(RECORD.expiresAt))).toBeInTheDocument();
    expect(screen.getByText(formatNullableDateTime(RECORD.completedAt))).toBeInTheDocument();
  });

  it('gives the row a single link, leaving the trailing arrow decorative', () => {
    renderRow('/onboardings');

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: RECORD.onboardingId })).toHaveAttribute(
      'href',
      `/onboardings/${RECORD.onboardingId}`,
    );
  });
});
