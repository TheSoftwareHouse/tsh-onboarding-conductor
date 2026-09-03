import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOnboardingTransitions } from '@/features/onboarding/api/admin-onboarding-transitions';
import { fetchAdminOnboardingById } from '@/features/onboarding/api/admin-onboardings';
import { fetchWorkflowDefinition } from '@/features/onboarding/api/admin-workflow-definition';
import type { OnboardingTransition, WorkflowDefinition } from '@/features/onboarding';
import {
  ONBOARDING_DETAILS_ROUTE,
  buildOnboardingDetailsPath,
  type AdminOnboardingDetail,
} from '@/features/onboarding';
import { AdminOnboardingDetailsPage } from './AdminOnboardingDetailsPage';

vi.mock('@/features/onboarding/api/admin-onboardings', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/onboarding/api/admin-onboardings')>();

  return { ...actual, fetchAdminOnboardingById: vi.fn() };
});

vi.mock('@/features/onboarding/api/admin-workflow-definition', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/onboarding/api/admin-workflow-definition')>();

  return { ...actual, fetchWorkflowDefinition: vi.fn() };
});

vi.mock('@/features/onboarding/api/admin-onboarding-transitions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/onboarding/api/admin-onboarding-transitions')>();

  return { ...actual, fetchOnboardingTransitions: vi.fn() };
});

const mockedFetchOnboarding = vi.mocked(fetchAdminOnboardingById);
const mockedFetchTransitions = vi.mocked(fetchOnboardingTransitions);
const mockedFetchWorkflowDefinition = vi.mocked(fetchWorkflowDefinition);

/** A workflow that forks into two reviews and reconverges on one approved step. */
const DEFINITION: WorkflowDefinition = {
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  name: 'KYC basic',
  initialStep: 'collect-documents',
  steps: [
    {
      name: 'collect-documents',
      status: 'awaiting_user',
      terminal: false,
      transitions: [{ status: 'success', target: 'review-documents' }],
    },
    {
      name: 'review-documents',
      status: 'awaiting_manual_review',
      terminal: false,
      transitions: [
        { status: 'manual.approve', target: 'approved' },
        { status: 'manual.reject', target: 'rejected' },
      ],
    },
    {
      name: 'escalate',
      status: 'awaiting_manual_review',
      terminal: false,
      transitions: [{ status: 'manual.approve', target: 'approved' }],
    },
    { name: 'approved', status: 'approved', terminal: true, transitions: [] },
    { name: 'rejected', status: 'rejected', terminal: true, transitions: [] },
  ],
};

const ONBOARDING_ID = '018f1e2a-1111-7000-8000-000000000001';

const SUMMARY: AdminOnboardingDetail = {
  onboardingId: ONBOARDING_ID,
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  status: 'approved',
  currentStep: null,
  expiresAt: null,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T12:00:00.000Z',
  completedAt: '2026-07-01T12:00:00.000Z',
  score: 40,
  scoreByStep: { collect_documents: 30, verify_identity: 10 },
};

function move(overrides: Partial<OnboardingTransition>): OnboardingTransition {
  return {
    id: 'row-1',
    occurredAt: '2026-07-01T10:00:00.000Z',
    label: 'collect-documents',
    status: 'awaiting_user',
    fromStep: null,
    appliedStep: null,
    enteredStep: 'collect-documents',
    trigger: null,
    current: false,
    scoreAfter: 0,
    scoreDelta: 0,
    skippedSteps: [],
    ...overrides,
  };
}

/** A journey that started, waited on review, and was approved by an operator. */
const TRAIL: OnboardingTransition[] = [
  move({ id: 'row-1' }),
  move({
    id: 'row-2',
    occurredAt: '2026-07-01T11:00:00.000Z',
    label: 'review-documents',
    status: 'awaiting_manual_review',
    fromStep: 'collect-documents',
    appliedStep: 'collect-documents',
    enteredStep: 'review-documents',
  }),
  move({
    id: 'row-3',
    occurredAt: '2026-07-01T12:00:00.000Z',
    label: 'Approved',
    status: 'approved',
    fromStep: 'review-documents',
    appliedStep: 'review-documents',
    enteredStep: 'approved',
    trigger: 'manual.approve',
    current: true,
  }),
];

function trail(
  transitions: OnboardingTransition[],
  truncated = false,
): Awaited<ReturnType<typeof fetchOnboardingTransitions>> {
  return { transitions, truncated };
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

function renderPage(listSearch = ''): void {
  render(
    <MemoryRouter initialEntries={[`${buildOnboardingDetailsPath(ONBOARDING_ID)}${listSearch}`]}>
      <QueryClientProvider client={createTestQueryClient()}>
        <Routes>
          <Route path={ONBOARDING_DETAILS_ROUTE} element={<AdminOnboardingDetailsPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedFetchOnboarding.mockReset();
  mockedFetchTransitions.mockReset();
  mockedFetchWorkflowDefinition.mockReset();
  // Most cases are about the record and the trail, so the definition is refused by default and
  // the view falls back to the recorded transitions.
  mockedFetchWorkflowDefinition.mockRejectedValue(new Error('Request failed with status 403.'));
});

afterEach(() => {
  cleanup();
});

describe('AdminOnboardingDetailsPage', () => {
  it('reads the onboarding and its trail for the id in the path', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Showing 3 recorded transitions.');
    });
    expect(mockedFetchOnboarding).toHaveBeenCalledWith(ONBOARDING_ID);
    expect(mockedFetchTransitions).toHaveBeenCalledWith(ONBOARDING_ID);
  });

  it('shows a loading status and an inert Reload while the reads are pending', () => {
    mockedFetchOnboarding.mockReturnValue(new Promise(() => {}));
    mockedFetchTransitions.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading onboarding…');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Onboarding record' })).not.toBeInTheDocument();
  });

  it('graphs the states in the order they were entered, marking where the onboarding stands', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    const graph = await screen.findByRole('region', { name: 'State transitions' });
    const nodes = within(graph).getAllByRole('listitem');

    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toHaveTextContent('collect-documents');
    expect(nodes[1]).toHaveTextContent('review-documents');
    expect(nodes[1]).toHaveTextContent('Awaiting manual review');
    expect(nodes[2]).toHaveTextContent('Approved');
    expect(nodes[2]).toHaveTextContent('Triggered by manual.approve');
    expect(nodes[2]).toHaveTextContent('Current state');
    expect(nodes[0]).not.toHaveTextContent('Current state');
  });

  it('shows the onboarding record beside the graph', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    const record = await screen.findByRole('region', { name: 'Onboarding record' });

    expect(within(record).getByText(ONBOARDING_ID)).toBeInTheDocument();
    expect(within(record).getByText('kyc-basic')).toBeInTheDocument();
    expect(within(record).getByText('Approved')).toBeInTheDocument();
  });

  it('says an id that matches nothing matched nothing, rather than reporting a failure', async () => {
    mockedFetchOnboarding.mockResolvedValue(null);
    mockedFetchTransitions.mockResolvedValue(trail([]));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No onboarding matches this ID.');
    });
    expect(screen.queryByRole('region', { name: 'Onboarding record' })).not.toBeInTheDocument();
  });

  it('reports an onboarding whose trail holds no transitions yet without an empty graph', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail([]));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'No state transitions have been recorded for this onboarding yet.',
      );
    });
    expect(screen.getByRole('region', { name: 'Onboarding record' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'State transitions' })).not.toBeInTheDocument();
  });

  it('says so when the endpoint reported only part of the trail', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL, true));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Showing the 3 most recently recorded transitions; earlier ones are not displayed.',
      );
    });
  });

  it('surfaces the failure message when a read is refused', async () => {
    mockedFetchOnboarding.mockRejectedValue(new Error('Request failed with status 403.'));
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load onboarding: Request failed with status 403.',
      );
    });
    expect(screen.queryByRole('region', { name: 'State transitions' })).not.toBeInTheDocument();
  });

  it('re-reads both endpoints when the operator reloads', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();
    await screen.findByRole('region', { name: 'State transitions' });

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => {
      expect(mockedFetchOnboarding).toHaveBeenCalledTimes(2);
      expect(mockedFetchTransitions).toHaveBeenCalledTimes(2);
    });
  });

  it('draws every declared step, marking the walked path and the branch never taken', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));
    mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);

    renderPage();

    const workflow = await screen.findByRole('region', { name: 'Workflow' });
    // React Flow tags every node element with its own test id, which is what this counts; a plain
    // role query would also catch the `<g>` elements its edges render, which carry one too.
    const nodes = within(workflow).getAllByTestId(/^rf__node-/);

    expect(mockedFetchWorkflowDefinition).toHaveBeenCalledWith('kyc-basic', 1);
    // Every declared step is drawn, including the one this onboarding never reached.
    expect(nodes).toHaveLength(5);
    expect(within(workflow).getByText('escalate')).toBeInTheDocument();
    expect(within(workflow).getByText('rejected')).toBeInTheDocument();
    // Each step says how far this onboarding got with it, in words as well as in colour.
    expect(within(workflow).getAllByText('Not taken').length).toBeGreaterThan(0);
    expect(
      within(workflow).getAllByText((text) => text.startsWith('Completed ·')).length,
    ).toBeGreaterThan(0);
    // The full graph replaces the plain transition chain.
    expect(screen.queryByRole('region', { name: 'State transitions' })).not.toBeInTheDocument();
  });

  it('falls back to the recorded transitions when the definition cannot be read', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    // The definition is an enrichment: refusing it must not cost the operator the trail.
    expect(await screen.findByRole('region', { name: 'State transitions' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Workflow' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 recorded transitions.');
  });

  it('shows the score after each move and names only the steps it bypassed', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(
      trail([
        move({ id: 'row-1', scoreAfter: 30, scoreDelta: 30 }),
        move({
          id: 'row-2',
          label: 'approved',
          status: 'approved',
          scoreAfter: 40,
          scoreDelta: 10,
          skippedSteps: ['enhanced_due_diligence'],
          current: true,
        }),
      ]),
    );

    renderPage();

    expect(await screen.findByText('Score 30 (+30)')).toBeInTheDocument();
    expect(screen.getByText('Score 40 (+10)')).toBeInTheDocument();
    // Only the move that bypassed something says so.
    expect(screen.getAllByText(/^Skipped /)).toHaveLength(1);
    expect(screen.getByText('Skipped enhanced_due_diligence')).toBeInTheDocument();
  });

  it('shows the running score without a delta when a move did not change it', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(
      trail([move({ id: 'row-1', scoreAfter: 30, scoreDelta: 0, current: true })]),
    );

    renderPage();

    expect(await screen.findByText('Score 30')).toBeInTheDocument();
  });

  it('renders the per-step breakdown on the summary card', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    expect(
      await screen.findByText('collect_documents +30 · verify_identity +10'),
    ).toBeInTheDocument();
  });

  it('offers the way back to the list it was opened from', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    expect(screen.getByRole('link', { name: '← Back to onboardings' })).toHaveAttribute(
      'href',
      '/onboardings',
    );
  });

  it('keeps the criteria of the filtered list it was opened from on the way back', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage('?status=approved');

    expect(screen.getByRole('link', { name: '← Back to onboardings' })).toHaveAttribute(
      'href',
      '/onboardings?status=approved',
    );
  });
});
