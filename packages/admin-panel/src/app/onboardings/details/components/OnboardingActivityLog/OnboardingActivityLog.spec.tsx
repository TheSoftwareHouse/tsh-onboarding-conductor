import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboardingActivity } from '../../hooks/useOnboardingActivity';
import { OnboardingActivityLog } from './OnboardingActivityLog';

vi.mock('../../hooks/useOnboardingActivity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useOnboardingActivity')>()),
  useOnboardingActivity: vi.fn(),
}));

const mockedUseOnboardingActivity = vi.mocked(useOnboardingActivity);
const ONBOARDING_ID = '018f1e2a-1111-7000-8000-000000000001';

function renderLog(): void {
  render(
    <MemoryRouter>
      <OnboardingActivityLog onboardingId={ONBOARDING_ID} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedUseOnboardingActivity.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('OnboardingActivityLog', () => {
  it('shows a loading line while the read is pending', () => {
    mockedUseOnboardingActivity.mockReturnValue({
      phase: 'loading',
      entries: [],
      total: 0,
      error: null,
    });

    renderLog();

    expect(screen.getByText('Loading activity…')).toBeInTheDocument();
  });

  it('shows the failure message when the read is refused', () => {
    mockedUseOnboardingActivity.mockReturnValue({
      phase: 'error',
      entries: [],
      total: 0,
      error: 'Request failed with status 403.',
    });

    renderLog();

    expect(
      screen.getByText('Unable to load activity: Request failed with status 403.'),
    ).toBeInTheDocument();
  });

  it('shows a plain line when the onboarding carries no recorded activity', () => {
    mockedUseOnboardingActivity.mockReturnValue({
      phase: 'ready',
      entries: [],
      total: 0,
      error: null,
    });

    renderLog();

    expect(
      screen.getByText('No activity has been recorded for this onboarding yet.'),
    ).toBeInTheDocument();
  });

  it('reports how many of the total entries are shown', () => {
    mockedUseOnboardingActivity.mockReturnValue({
      phase: 'ready',
      entries: [
        {
          id: 'row-1',
          occurredAt: '2026-09-02T11:48:31.000Z',
          action: 'onboarding.state_transition',
          metadata: {},
        },
      ],
      total: 24,
      error: null,
    });

    renderLog();

    expect(screen.getByText('1 of 24 entries')).toBeInTheDocument();
  });

  it('styles failure actions by the same rule as the Logs table', () => {
    mockedUseOnboardingActivity.mockReturnValue({
      phase: 'ready',
      entries: [
        {
          id: 'row-1',
          occurredAt: '2026-08-31T09:16:44.000Z',
          action: 'onboarding.rejected_attempt',
          metadata: { reason: 'CHALLENGE_EXPIRED' },
        },
        {
          id: 'row-2',
          occurredAt: '2026-08-31T09:15:10.000Z',
          action: 'connector.failure_retried',
          metadata: {},
        },
        {
          id: 'row-3',
          occurredAt: '2026-08-31T09:14:02.000Z',
          action: 'onboarding.started',
          metadata: {},
        },
      ],
      total: 3,
      error: null,
    });

    renderLog();

    expect(screen.getByText('onboarding.rejected_attempt')).toHaveClass('text-tsh-red');
    expect(screen.getByText('connector.failure_retried')).not.toHaveClass('text-tsh-red');
    expect(screen.getByText('onboarding.started')).not.toHaveClass('text-tsh-red');
  });

  it('renders a one-line summary of the entry metadata', () => {
    mockedUseOnboardingActivity.mockReturnValue({
      phase: 'ready',
      entries: [
        {
          id: 'row-1',
          occurredAt: '2026-08-31T09:14:03.000Z',
          action: 'connector.execute',
          metadata: { connector: 'otp', status: 201 },
        },
      ],
      total: 1,
      error: null,
    });

    renderLog();

    expect(screen.getByText('connector: otp · status: 201')).toBeInTheDocument();
  });

  it('clips a long metadata value with an ellipsis, keeping the full value in the title', () => {
    const longValue =
      '{"endpoint":"https://webhooks.example.com/sumsub_kyc","error":"ECONNREFUSED","retryCount":3}';
    mockedUseOnboardingActivity.mockReturnValue({
      phase: 'ready',
      entries: [
        {
          id: 'row-1',
          occurredAt: '2026-08-31T09:14:03.000Z',
          action: 'webhook.outbound_endpoint_resolution_failed',
          metadata: { payload: longValue },
        },
      ],
      total: 1,
      error: null,
    });

    renderLog();

    const summary = screen.getByTitle(`payload: ${longValue}`);
    expect(summary).toHaveClass('truncate');
    expect(summary.textContent).not.toEqual(`payload: ${longValue}`);
    expect(summary.textContent).toMatch(/…$/);
  });

  it('caps the number of metadata pairs rendered on the line', () => {
    mockedUseOnboardingActivity.mockReturnValue({
      phase: 'ready',
      entries: [
        {
          id: 'row-1',
          occurredAt: '2026-08-31T09:14:03.000Z',
          action: 'connector.execute',
          metadata: { a: 1, b: 2, c: 3, d: 4, e: 5 },
        },
      ],
      total: 1,
      error: null,
    });

    renderLog();

    expect(screen.getByText('a: 1 · b: 2 · c: 3')).toBeInTheDocument();
    expect(screen.getByTitle('a: 1 · b: 2 · c: 3 · d: 4 · e: 5')).toBeInTheDocument();
  });

  it('links to the audit log filtered to this onboarding, both above and below the rows', () => {
    mockedUseOnboardingActivity.mockReturnValue({
      phase: 'ready',
      entries: [
        {
          id: 'row-1',
          occurredAt: '2026-09-02T11:48:31.000Z',
          action: 'onboarding.started',
          metadata: {},
        },
      ],
      total: 1,
      error: null,
    });

    renderLog();

    const expectedHref = `/audit?resourceType=onboarding&resourceId=${ONBOARDING_ID}`;
    const links = screen.getAllByRole('link', { name: /See/ });

    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link).toHaveAttribute('href', expectedHref));
    expect(screen.getByRole('link', { name: '→ See in Logs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '→ See all 1 entries in Logs' })).toBeInTheDocument();
  });
});
