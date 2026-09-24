import '@testing-library/jest-dom/vitest';
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { OnboardingDetailsHeader } from './OnboardingDetailsHeader';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import type {
  WorkflowDefinition,
  WorkflowStepDefinition,
} from '@/api/workflows/workflow-definitions';

const ONBOARDING_ID = '018f1e2a-1111-7000-8000-000000000001';

function summary(overrides: Partial<AdminOnboardingSummary> = {}): AdminOnboardingSummary {
  return {
    onboardingId: ONBOARDING_ID,
    workflowId: 'manual-review',
    workflowVersion: 1,
    status: 'awaiting_manual_review',
    currentStep: 'awaiting_manual_review',
    expiresAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    completedAt: null,
    scores: {},
    ...overrides,
  };
}

function step(overrides: Partial<WorkflowStepDefinition> = {}): WorkflowStepDefinition {
  return {
    name: 'awaiting_manual_review',
    status: 'awaiting_manual_review',
    terminal: false,
    transitions: [{ status: 'manual.approve', target: 'approved' }],
    ...overrides,
  };
}

function definition(steps: WorkflowStepDefinition[]): WorkflowDefinition {
  return {
    workflowId: 'manual-review',
    workflowVersion: 1,
    name: 'Manual Review',
    initialStep: 'awaiting_manual_review',
    scores: {},
    steps,
  };
}

function renderHeader(ui: ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );

  return render(ui, { wrapper: Wrapper });
}

afterEach(() => {
  cleanup();
});

describe('OnboardingDetailsHeader', () => {
  it('renders from the id alone when no summary is available', () => {
    renderHeader(
      <OnboardingDetailsHeader
        onboardingId={ONBOARDING_ID}
        summary={null}
        definition={null}
        backSearch=""
        onRefresh={() => {}}
        pendingAction={null}
        onReviewSubmit={() => {}}
        isRefreshing={false}
        statusMessage="Loading onboarding…"
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: ONBOARDING_ID })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText('Awaiting manual review')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('renders the chip, workflow line and review actions once a summary is available', () => {
    renderHeader(
      <OnboardingDetailsHeader
        onboardingId={ONBOARDING_ID}
        summary={summary()}
        definition={definition([step()])}
        backSearch="?status=awaiting_manual_review"
        onRefresh={() => {}}
        pendingAction={null}
        onReviewSubmit={() => {}}
        isRefreshing={false}
        statusMessage={null}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: ONBOARDING_ID })).toBeInTheDocument();
    expect(screen.getByText('Awaiting manual review')).toBeInTheDocument();
    expect(screen.getByText(/Workflow manual-review/)).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('renders the status message as a live region within the header itself', () => {
    renderHeader(
      <OnboardingDetailsHeader
        onboardingId={ONBOARDING_ID}
        summary={null}
        definition={null}
        backSearch=""
        onRefresh={() => {}}
        pendingAction={null}
        onReviewSubmit={() => {}}
        isRefreshing={false}
        statusMessage="Loading onboarding…"
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading onboarding…');
    expect(screen.getByRole('banner')).toContainElement(status);
  });

  it('carries the handed-in search string on the back link', () => {
    renderHeader(
      <OnboardingDetailsHeader
        onboardingId={ONBOARDING_ID}
        summary={null}
        definition={null}
        backSearch="?status=awaiting_manual_review"
        onRefresh={() => {}}
        pendingAction={null}
        onReviewSubmit={() => {}}
        isRefreshing={false}
        statusMessage={null}
      />,
    );

    expect(screen.getByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'href',
      '/onboardings?status=awaiting_manual_review',
    );
  });

  it('disables the refresh control while a refresh is in flight', () => {
    renderHeader(
      <OnboardingDetailsHeader
        onboardingId={ONBOARDING_ID}
        summary={null}
        definition={null}
        backSearch=""
        onRefresh={() => {}}
        pendingAction={null}
        onReviewSubmit={() => {}}
        isRefreshing
        statusMessage={null}
      />,
    );

    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
  });

  it('disables the refresh control while a review decision is in flight', () => {
    renderHeader(
      <OnboardingDetailsHeader
        onboardingId={ONBOARDING_ID}
        summary={summary()}
        definition={null}
        backSearch=""
        onRefresh={() => {}}
        pendingAction="approve"
        onReviewSubmit={() => {}}
        isRefreshing={false}
        statusMessage={null}
      />,
    );

    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
  });

  it('renders no live region at all when the page has nothing to report', () => {
    renderHeader(
      <OnboardingDetailsHeader
        onboardingId={ONBOARDING_ID}
        summary={summary()}
        definition={null}
        backSearch=""
        onRefresh={() => {}}
        pendingAction={null}
        onReviewSubmit={() => {}}
        isRefreshing={false}
        statusMessage={null}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
