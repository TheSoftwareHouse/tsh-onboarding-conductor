import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTime } from '@/lib/format-date-time';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import { OnboardingRunMeta } from './OnboardingRunMeta';

afterEach(() => {
  cleanup();
});

const BASE_SUMMARY: AdminOnboardingSummary = {
  onboardingId: '01a023ea-bf9e-772d-9f5a-f49b33b3dd1a',
  workflowId: 'eu-b2c-individual-kyc-eea',
  workflowVersion: 1,
  status: 'awaiting_manual_review',
  currentStep: 'manual_review',
  expiresAt: '2026-09-14T09:14:00.000Z',
  createdAt: '2026-08-31T09:14:00.000Z',
  updatedAt: '2026-09-02T11:48:00.000Z',
  completedAt: null,
  scores: {},
};

const NOW = new Date('2026-09-03T13:14:00.000Z');

describe('OnboardingRunMeta', () => {
  it('renders all five items for an in-flight onboarding with an expiry', () => {
    render(
      <OnboardingRunMeta
        summary={BASE_SUMMARY}
        lastTransitionOccurredAt="2026-09-02T11:48:00.000Z"
        now={NOW}
      />,
    );

    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(BASE_SUMMARY.createdAt))).toBeInTheDocument();
    expect(screen.getByText('Last update')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(BASE_SUMMARY.updatedAt))).toBeInTheDocument();
    expect(screen.getByText('In manual_review')).toBeInTheDocument();
    expect(screen.getByText('1 d 1 h')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('3 d 4 h')).toBeInTheDocument();
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(BASE_SUMMARY.expiresAt!))).toBeInTheDocument();
  });

  it('omits the In item when there is no current step', () => {
    render(
      <OnboardingRunMeta
        summary={{ ...BASE_SUMMARY, currentStep: null }}
        lastTransitionOccurredAt={null}
        now={NOW}
      />,
    );

    expect(screen.queryByText(/^In /)).not.toBeInTheDocument();
  });

  it('omits the Expires item when expiresAt is null', () => {
    render(
      <OnboardingRunMeta
        summary={{ ...BASE_SUMMARY, expiresAt: null }}
        lastTransitionOccurredAt="2026-09-02T11:48:00.000Z"
        now={NOW}
      />,
    );

    expect(screen.queryByText('Expires')).not.toBeInTheDocument();
  });

  it('measures Total to completedAt for a settled record', () => {
    render(
      <OnboardingRunMeta
        summary={{
          ...BASE_SUMMARY,
          currentStep: null,
          completedAt: '2026-09-01T09:14:00.000Z',
        }}
        lastTransitionOccurredAt={null}
        now={NOW}
      />,
    );

    expect(screen.getByText('1 d')).toBeInTheDocument();
  });
});
