import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { ApiError } from '@/services/api/api-error';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import { BrowserRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAdminOnboardingById,
  type AdminOnboardingSummary,
} from '@/api/onboardings/admin-onboardings';
import { ADMIN_ROUTES } from '@/constants/routes';
import { fetchAuditEvents } from '@/api/audit/audit-events';
import { submitOnboardingReview } from '@/api/onboardings/onboarding-review';
import {
  fetchOnboardingTransitions,
  type OnboardingTransition,
} from '@/api/onboardings/onboarding-transitions';
import {
  fetchWorkflowDefinition,
  type WorkflowDefinition,
} from '@/api/workflows/workflow-definitions';
import { Toaster } from '@/components/ui/Toast/Toaster';
import { OnboardingDetailsPage } from './OnboardingDetailsPage';

vi.mock('@/api/onboardings/admin-onboardings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/onboardings/admin-onboardings')>();

  return { ...actual, fetchAdminOnboardingById: vi.fn() };
});

vi.mock('@/api/workflows/workflow-definitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-definitions')>();

  return { ...actual, fetchWorkflowDefinition: vi.fn() };
});

vi.mock('@/api/onboardings/onboarding-transitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/onboardings/onboarding-transitions')>();

  return { ...actual, fetchOnboardingTransitions: vi.fn() };
});

vi.mock('@/api/audit/audit-events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/audit/audit-events')>();

  return { ...actual, fetchAuditEvents: vi.fn() };
});

vi.mock('@/api/onboardings/onboarding-review', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/onboardings/onboarding-review')>();

  return { ...actual, submitOnboardingReview: vi.fn() };
});

const mockedFetchOnboarding = vi.mocked(fetchAdminOnboardingById);
const mockedFetchTransitions = vi.mocked(fetchOnboardingTransitions);
const mockedFetchWorkflowDefinition = vi.mocked(fetchWorkflowDefinition);
const mockedFetchActivity = vi.mocked(fetchAuditEvents);
const mockedSubmitReview = vi.mocked(submitOnboardingReview);

/** A workflow with one manual-review step declaring both Approve and Reject. */
const DEFINITION: WorkflowDefinition = {
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  name: null,
  initialStep: 'collect-documents',
  scores: { risk: { min: 0, max: 100 } },
  webhook: null,
  steps: [
    {
      name: 'collect-documents',
      status: 'awaiting_user',
      terminal: false,
      transitions: [{ status: 'success', target: 'review-documents', reason: null }],
      source: null,
      fields: [],
      connectors: [],
    },
    {
      name: 'review-documents',
      status: 'awaiting_manual_review',
      terminal: false,
      transitions: [
        { status: 'manual.approve', target: 'approved', reason: null },
        { status: 'manual.reject', target: 'rejected', reason: null },
      ],
      source: null,
      fields: [],
      connectors: [],
    },
    {
      name: 'approved',
      status: 'approved',
      terminal: true,
      transitions: [],
      source: null,
      fields: [],
      connectors: [],
    },
    {
      name: 'rejected',
      status: 'rejected',
      terminal: true,
      transitions: [],
      source: null,
      fields: [],
      connectors: [],
    },
  ],
};

const ONBOARDING_ID = '018f1e2a-1111-7000-8000-000000000001';

/** A settled onboarding: no current step, no review actions. */
const SUMMARY: AdminOnboardingSummary = {
  onboardingId: ONBOARDING_ID,
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  status: 'approved',
  currentStep: null,
  expiresAt: null,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T12:00:00.000Z',
  completedAt: '2026-07-01T12:00:00.000Z',
  scores: {},
};

/** The same onboarding, carrying a score the fixture workflow declares bounds for. */
const SUMMARY_WITH_SCORE: AdminOnboardingSummary = { ...SUMMARY, scores: { risk: 55 } };

/** Still in flight, waiting on the manual-review step the definition declares actions for. */
const SUMMARY_AWAITING_REVIEW: AdminOnboardingSummary = {
  ...SUMMARY,
  status: 'awaiting_manual_review',
  currentStep: 'review-documents',
  completedAt: null,
};

function move(overrides: Partial<OnboardingTransition>): OnboardingTransition {
  return {
    id: 'row-1',
    occurredAt: '2026-07-01T10:00:00.000Z',
    status: 'awaiting_user',
    fromStep: null,
    appliedStep: null,
    enteredStep: 'collect-documents',
    trigger: null,
    current: false,
    ...overrides,
  };
}

/** A journey that started, waited on review, and was approved by an operator. */
const TRAIL: OnboardingTransition[] = [
  move({ id: 'row-1' }),
  move({
    id: 'row-2',
    occurredAt: '2026-07-01T11:00:00.000Z',
    status: 'awaiting_manual_review',
    fromStep: 'collect-documents',
    appliedStep: 'collect-documents',
    enteredStep: 'review-documents',
    current: true,
  }),
  move({
    id: 'row-3',
    occurredAt: '2026-07-01T12:00:00.000Z',
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
  return createQueryClient();
}

/**
 * `BrowserRouter` reads and writes the same `window.history` the nuqs react-router adapter does,
 * so seeding the path (the id, the list's filters and `tab`) is a single write before render.
 */
function renderPage(search = ''): void {
  window.history.replaceState(
    {},
    '',
    `${ADMIN_ROUTES.onboardings.details(ONBOARDING_ID)}${search}`,
  );

  render(
    <BrowserRouter>
      <NuqsAdapter>
        <QueryClientProvider client={createTestQueryClient()}>
          <Toaster>
            <Routes>
              <Route
                path={ADMIN_ROUTES.onboardings.detailsPattern}
                element={<OnboardingDetailsPage />}
              />
            </Routes>
          </Toaster>
        </QueryClientProvider>
      </NuqsAdapter>
    </BrowserRouter>,
  );
}

/** The toast root for `title` — `Toast.Title`/`Description` also carry `data-type`, so this walks to the outermost match. */
async function findToast(title: string): Promise<HTMLElement> {
  const nodes = await screen.findAllByText(title);
  for (const node of nodes) {
    let root: Element | null = null;
    for (let current: Element | null = node; current; current = current.parentElement) {
      if (current.hasAttribute('data-type')) {
        root = current;
      }
    }
    if (root) {
      return root as HTMLElement;
    }
  }
  throw new Error(`No toast root found for "${title}"`);
}

beforeEach(() => {
  mockedFetchOnboarding.mockReset();
  mockedFetchTransitions.mockReset();
  mockedFetchWorkflowDefinition.mockReset();
  mockedFetchActivity.mockReset();
  mockedSubmitReview.mockReset();
  // Most cases are about the record and the trail; the definition and the activity log are
  // enrichments this page must not depend on to show its main status.
  mockedFetchWorkflowDefinition.mockRejectedValue(new Error('Request failed with status 403.'));
  mockedFetchActivity.mockResolvedValue({
    events: [],
    pagination: { page: 1, limit: 6, total: 0, totalPages: 0 },
  });
});

afterEach(() => {
  cleanup();
});

describe('OnboardingDetailsPage', () => {
  it('reads the onboarding and its trail for the id in the path', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Path taken' })).toBeInTheDocument();
    expect(mockedFetchOnboarding).toHaveBeenCalledWith(ONBOARDING_ID);
    expect(mockedFetchTransitions).toHaveBeenCalledWith(ONBOARDING_ID);
  });

  it('renders the status line inside the header band rather than as a band of its own', () => {
    mockedFetchOnboarding.mockReturnValue(new Promise(() => {}));
    mockedFetchTransitions.mockReturnValue(new Promise(() => {}));

    renderPage();

    const header = screen.getByRole('status').closest('header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('reports nothing once the page is read, leaving each band to describe what it holds', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Path taken' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('shows a loading status and an inert Reload while the reads are pending', () => {
    mockedFetchOnboarding.mockReturnValue(new Promise(() => {}));
    mockedFetchTransitions.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading onboarding…');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Path taken' })).not.toBeInTheDocument();
  });

  it('defaults to the History tab, showing the path taken', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Path taken' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activity log' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Scores' })).not.toBeInTheDocument();
  });

  it('opens the Scores tab when the URL asks for it', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY_WITH_SCORE);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));
    mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);

    renderPage('?tab=scores');

    expect(await screen.findByRole('heading', { name: 'Scores' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Path taken' })).not.toBeInTheDocument();
  });

  it('offers no Scores tab when the workflow declares no scores', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    expect(await screen.findByRole('link', { name: 'History' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Scores/ })).not.toBeInTheDocument();
  });

  it('falls back to History when the URL asks for Scores the workflow does not declare', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage('?tab=scores');

    expect(await screen.findByRole('heading', { name: 'Path taken' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Scores' })).not.toBeInTheDocument();
  });

  it('writes the clicked tab to the URL and swaps the tab body', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY_WITH_SCORE);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));
    mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);

    renderPage();
    await screen.findByRole('heading', { name: 'Path taken' });

    await userEvent.click(screen.getByRole('link', { name: /Scores/ }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Scores' })).toBeInTheDocument();
    });
    expect(window.location.search).toBe('?tab=scores');
    expect(screen.queryByRole('heading', { name: 'Path taken' })).not.toBeInTheDocument();
  });

  it('keeps the list filters in the URL when switching tabs, and off the back link', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY_WITH_SCORE);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));
    mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);

    renderPage('?status=awaiting_manual_review');
    await screen.findByRole('heading', { name: 'Path taken' });

    await userEvent.click(screen.getByRole('link', { name: /Scores/ }));

    await waitFor(() => {
      expect(window.location.search).toBe('?status=awaiting_manual_review&tab=scores');
    });
    expect(screen.getByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'href',
      '/onboardings?status=awaiting_manual_review',
    );
  });

  it('says an id that matches nothing matched nothing, rather than reporting a failure', async () => {
    mockedFetchOnboarding.mockResolvedValue(null);
    mockedFetchTransitions.mockResolvedValue(trail([]));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No onboarding matches this ID.');
    });
    expect(screen.queryByRole('heading', { name: 'Path taken' })).not.toBeInTheDocument();
  });

  it('does not re-read the workflow definition on reload when the id matches nothing', async () => {
    mockedFetchOnboarding.mockResolvedValue(null);
    mockedFetchTransitions.mockResolvedValue(trail([]));

    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No onboarding matches this ID.');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => {
      expect(mockedFetchOnboarding).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchWorkflowDefinition).not.toHaveBeenCalled();
  });

  it('reports an onboarding whose trail holds no transitions yet', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail([]));

    renderPage();

    expect(await screen.findByText('No steps recorded yet.')).toBeInTheDocument();
  });

  it('says so when the endpoint reported only part of the trail', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL, true));

    renderPage();

    expect(
      await screen.findByText('3 most recent steps · earlier steps not shown'),
    ).toBeInTheDocument();
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
  });

  it('re-reads every endpoint, including the activity log, when the operator reloads', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();
    await screen.findByRole('heading', { name: 'Path taken' });
    await waitFor(() => expect(mockedFetchActivity).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => {
      expect(mockedFetchOnboarding).toHaveBeenCalledTimes(2);
      expect(mockedFetchTransitions).toHaveBeenCalledTimes(2);
      expect(mockedFetchActivity).toHaveBeenCalledTimes(2);
    });
  });

  it('offers the way back to the list it was opened from', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));

    renderPage();

    expect(await screen.findByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'href',
      '/onboardings',
    );
  });

  it('keeps the list filters but drops the tab param on the way back', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY_WITH_SCORE);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));
    mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);

    renderPage('?status=approved&tab=scores');

    expect(await screen.findByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'href',
      '/onboardings?status=approved',
    );
  });

  it('invalidates the onboarding summary and the activity log, and raises a success toast, on a successful review decision', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY_AWAITING_REVIEW);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));
    mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);
    mockedSubmitReview.mockResolvedValue({ status: 'approved', currentStep: null });

    renderPage();
    await waitFor(() => expect(mockedFetchActivity).toHaveBeenCalledTimes(1));

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(mockedSubmitReview).toHaveBeenCalledWith(ONBOARDING_ID, 'approve');
    await waitFor(() => {
      expect(mockedFetchOnboarding).toHaveBeenCalledTimes(2);
      expect(mockedFetchTransitions).toHaveBeenCalledTimes(2);
      expect(mockedFetchActivity).toHaveBeenCalledTimes(2);
    });
    const toast = await findToast('Onboarding approved.');
    expect(toast).toHaveAttribute('data-type', 'success');
  });

  it('keeps Reload inert while a review decision is in flight, then raises the error toast', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY_AWAITING_REVIEW);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));
    mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);
    let rejectSubmit: (error: ApiError) => void = () => {};
    mockedSubmitReview.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSubmit = reject;
      }),
    );

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();

    rejectSubmit(new ApiError('Request failed with status 503.', { status: 503 }));

    const toast = await findToast('Unable to record the review decision:');
    expect(toast).toHaveTextContent('Request failed with status 503.');
    // Base UI announces a high-priority toast assertively through its hidden alert announcer.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to record the review decision:',
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('reports a failed review decision as an error toast even when the trail is truncated', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY_AWAITING_REVIEW);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL, true));
    mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);
    mockedSubmitReview.mockRejectedValue(
      new ApiError('Request failed with status 409.', { status: 409 }),
    );

    renderPage();
    expect(
      await screen.findByText('3 most recent steps · earlier steps not shown'),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockedFetchActivity).toHaveBeenCalledTimes(1));

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    // A 409 means the state moved underneath, so the page re-reads it as well as reporting it.
    await waitFor(() => {
      expect(mockedFetchOnboarding).toHaveBeenCalledTimes(2);
      expect(mockedFetchTransitions).toHaveBeenCalledTimes(2);
      expect(mockedFetchActivity).toHaveBeenCalledTimes(2);
    });
    const toast = await findToast('Unable to record the review decision:');
    expect(toast).toHaveTextContent('Request failed with status 409.');
  });

  it('recovers from a failed review once a later attempt succeeds', async () => {
    mockedFetchOnboarding.mockResolvedValue(SUMMARY_AWAITING_REVIEW);
    mockedFetchTransitions.mockResolvedValue(trail(TRAIL));
    mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);
    mockedSubmitReview.mockRejectedValueOnce(
      new ApiError('Request failed with status 409.', { status: 409 }),
    );
    mockedSubmitReview.mockResolvedValueOnce({ status: 'approved', currentStep: null });

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const errorToast = await findToast('Unable to record the review decision:');
    expect(errorToast).toHaveTextContent('Request failed with status 409.');

    // The 409 re-read the page, so the button is found again rather than reused.
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Onboarding approved.')).toBeInTheDocument();
  });
});
