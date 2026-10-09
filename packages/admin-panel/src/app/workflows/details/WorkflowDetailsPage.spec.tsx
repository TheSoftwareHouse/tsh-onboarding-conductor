import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/services/api/api-error';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import { BrowserRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowStepDefinition,
} from '@/api/workflows/workflow-definitions';
import { fetchWorkflowVersions, type WorkflowVersion } from '@/api/workflows/workflow-versions';
import { fetchWorkflowDocument, type WorkflowDraftDocument } from '@/api/workflows/workflow-drafts';
import { ADMIN_ROUTES } from '@/constants/routes';
import { WorkflowDetailsPage } from './WorkflowDetailsPage';

vi.mock('@/api/workflows/workflow-definitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-definitions')>();
  return { ...actual, fetchWorkflowDefinition: vi.fn() };
});

vi.mock('@/api/workflows/workflow-versions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-versions')>();
  return { ...actual, fetchWorkflowVersions: vi.fn() };
});

vi.mock('@/api/workflows/workflow-drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-drafts')>();
  return { ...actual, fetchWorkflowDocument: vi.fn() };
});

vi.mock('./components/DraftEditor/JsonEditor', () => ({
  JsonEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} value={value} readOnly />
  ),
}));

const mockedFetchDocument = vi.mocked(fetchWorkflowDocument);
const mockedFetchDefinition = vi.mocked(fetchWorkflowDefinition);
const mockedFetchVersions = vi.mocked(fetchWorkflowVersions);

const WORKFLOW_ID = 'kyc';
const UNPINNED_VERSION = 2;

function step(
  overrides: Partial<WorkflowStepDefinition> & { name: string },
): WorkflowStepDefinition {
  return {
    status: 'awaiting_user',
    terminal: false,
    transitions: [],
    source: null,
    fields: [],
    connectors: [],
    ...overrides,
  };
}

function definition(version: number, extraStep?: string): WorkflowDefinition {
  return {
    workflowId: WORKFLOW_ID,
    workflowVersion: version,
    name: 'KYC flow',
    initialStep: 'collect',
    scores: {},
    webhook: { notify: { path: 'notify' } },
    steps: [
      step({
        name: 'collect',
        source: { step: 'collect', type: 'form', category: 'data' },
        fields: [
          {
            name: 'email',
            type: 'text',
            required: true,
            persist: true,
            schema: { format: 'email' },
            upload: null,
          },
        ],
        transitions: [
          {
            status: 'success',
            target: 'verify',
            when: { field: 'email', equals: 'x' },
            reason: null,
          },
        ],
      }),
      step({
        name: 'verify',
        status: 'awaiting_manual_review',
        connectors: [
          {
            id: 'twilio_verify',
            name: 'twilio_verify',
            type: 'phone-verification',
            order: 1,
            canReject: true,
            async: false,
            fieldMapping: { recipient: 'phoneNumber' },
            optionalFieldMapping: { issuingCountry: 'passportIssuingCountry' },
            fallbacks: [],
          },
        ],
        transitions: [
          { status: 'success', target: 'done', reason: null },
          { status: 'retry', target: null, reason: null },
        ],
      }),
      step({ name: 'done', status: 'approved', terminal: true }),
      ...(extraStep === undefined ? [] : [step({ name: extraStep })]),
    ],
  };
}

function versions(...entries: Array<[number, WorkflowVersion['status']]>): WorkflowVersion[] {
  return entries.map(([version, status]) => ({
    version,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));
}

function renderPage(search = ''): void {
  window.history.replaceState({}, '', `${ADMIN_ROUTES.workflows.details(WORKFLOW_ID)}${search}`);

  render(
    <BrowserRouter>
      <NuqsAdapter>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path={ADMIN_ROUTES.workflows.detailsPattern} element={<WorkflowDetailsPage />} />
          </Routes>
        </QueryClientProvider>
      </NuqsAdapter>
    </BrowserRouter>,
  );
}

async function findInspectorHeading(name: string): Promise<HTMLElement> {
  return within(await screen.findByRole('complementary')).findByRole('heading', {
    level: 2,
    name,
  });
}

beforeEach(() => {
  // Unpinned, the engine serves the highest published version; the fixtures publish v2.
  mockedFetchDefinition.mockImplementation((_id, version = UNPINNED_VERSION) =>
    Promise.resolve(definition(version, version === 1 ? 'legacy_only' : undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorkflowDetailsPage', () => {
  it('selects the initial step by default and shows the header and stats', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    renderPage();

    expect(await findInspectorHeading('collect')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'KYC flow' })).toBeInTheDocument();
    expect(screen.getByText('3 steps')).toBeInTheDocument();
    expect(screen.getByText('3 transitions')).toBeInTheDocument();
    expect(screen.getByText('/notify')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('text · required · format email')).toBeInTheDocument();
    expect(screen.getByText('Collect data')).toBeInTheDocument();
  });

  it('changes the inspector and ?step= when a node is clicked', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    renderPage();
    await findInspectorHeading('collect');

    const node = document.querySelector('.react-flow__node[data-id="verify"]');
    fireEvent.click(node as Element);

    expect(await findInspectorHeading('verify')).toBeInTheDocument();
    expect(window.location.search).toContain('step=verify');
  });

  it('shows a guarded edge label with the whole condition and pointer events on', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    renderPage();

    const label = await screen.findByTitle('success when email = x');

    expect(label).toHaveTextContent('email = x');
    expect(label).toHaveStyle({ pointerEvents: 'all' });
    expect(label).toHaveAttribute('tabindex', '0');
  });

  async function stubbedLabel(labelLeft: number, labelRight: number) {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    renderPage();
    const label = await screen.findByTitle('success when email = x');
    const canvas = label.closest('.react-flow') as HTMLElement;
    const rect = (left: number, right: number) =>
      ({ left, right, top: 0, bottom: 0, width: right - left, height: 0 }) as DOMRect;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect(0, 1000));
    vi.spyOn(label, 'getBoundingClientRect').mockReturnValue(rect(labelLeft, labelRight));
    const offset = () => Number(/translate\((-?[\d.]+)px/.exec(label.style.transform)?.[1]);
    return { label, offset, rest: offset() };
  }

  it('wraps an expanded label and keeps it inside the canvas', async () => {
    const { label, offset, rest } = await stubbedLabel(900, 1100);

    expect(label.className).toContain('truncate');
    fireEvent.pointerEnter(label);
    expect(label.className).toContain('whitespace-normal');
    expect(offset()).toBeCloseTo(rest - 108);

    fireEvent.pointerLeave(label);
    expect(offset()).toBeCloseTo(rest);
  });

  it('places a label the same on focus as on hover', async () => {
    const { label, offset, rest } = await stubbedLabel(900, 1100);

    fireEvent.pointerEnter(label);
    const hovered = label.style.transform;
    fireEvent.pointerLeave(label);
    fireEvent.focus(label);

    expect(label.style.transform).toBe(hovered);
    fireEvent.blur(label);
    expect(offset()).toBeCloseTo(rest);
  });

  it('does not shift an expanded label that fits in the canvas', async () => {
    const { label, offset, rest } = await stubbedLabel(400, 600);

    fireEvent.focus(label);
    expect(offset()).toBeCloseTo(rest);
    fireEvent.pointerEnter(label);
    expect(offset()).toBeCloseTo(rest);
  });

  it('falls back to the initial step for an unknown ?step=', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    renderPage('?step=nope');

    expect(await findInspectorHeading('collect')).toBeInTheDocument();
  });

  it('reads the definition unpinned without ?version= and shows the version it got', async () => {
    mockedFetchVersions.mockResolvedValue(versions([3, 'draft'], [2, 'published']));
    renderPage();

    await findInspectorHeading('collect');
    expect(mockedFetchDefinition).toHaveBeenCalledWith(WORKFLOW_ID, undefined);
    expect(screen.getByText('v2 published')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Version' })).toHaveValue('2');
  });

  it('pins the definition to a ?version= from the URL', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published'], [1, 'retired']));
    renderPage('?version=1');

    await findInspectorHeading('collect');
    expect(mockedFetchDefinition).toHaveBeenCalledWith(WORKFLOW_ID, 1);
    expect(screen.getByText('v1 retired')).toBeInTheDocument();
  });

  it('asks for a version when nothing is published or drafted, then shows the one chosen', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'retired'], [1, 'retired']));
    mockedFetchDefinition.mockImplementation((_id, version) =>
      version === undefined
        ? Promise.reject(new ApiError('Request failed with status 404.', { status: 404 }))
        : Promise.resolve(definition(version)),
    );
    renderPage();

    expect(await screen.findByText(/This workflow has no published version/)).toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Version' });
    expect(picker).toHaveValue('');

    await userEvent.selectOptions(picker, '1');

    expect(await findInspectorHeading('collect')).toBeInTheDocument();
    expect(screen.getByText('v1 retired')).toBeInTheDocument();
  });

  it('reports a ?version= the workflow does not hold', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    mockedFetchDefinition.mockRejectedValue(
      new ApiError('Request failed with status 404.', { status: 404 }),
    );
    renderPage('?version=9');

    expect(await screen.findByText(/Version 9 does not exist/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Version' })).toHaveValue('');
  });

  it('lists every version including retired and switches to it on its initial step', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published'], [1, 'retired']));
    renderPage('?step=verify');
    await findInspectorHeading('verify');

    const picker = screen.getByRole('combobox', { name: 'Version' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['v2 — published', 'v1 — retired']);

    await userEvent.selectOptions(picker, '1');

    await waitFor(() => expect(mockedFetchDefinition).toHaveBeenCalledWith(WORKFLOW_ID, 1));
    expect(await findInspectorHeading('collect')).toBeInTheDocument();
    expect(window.location.search).toContain('version=1');
    expect(window.location.search).not.toContain('step=');
    expect(screen.getByText('v1 retired')).toBeInTheDocument();
    expect(screen.getByText(/stored revisions never change shape/)).toBeInTheDocument();
  });

  it('shows the terminal note for a terminal step', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    renderPage('?step=done');

    await findInspectorHeading('done');
    expect(screen.getByText(/A terminal step collects nothing/)).toBeInTheDocument();
  });

  it('shows a connector step with its mapping and no config', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    renderPage('?step=verify');

    await findInspectorHeading('verify');
    const inspector = within(screen.getByRole('complementary'));
    const connectorField = inspector.getByText('recipient', { exact: false });
    const workflowField = inspector.getByText('phoneNumber');
    const arrows = inspector.getAllByText('→');
    expect(connectorField).toHaveTextContent('recipient →');
    expect(workflowField).toBeInTheDocument();
    expect(arrows.length).toBeGreaterThan(0);
    expect(inspector.getByText('passportIssuingCountry')).toBeInTheDocument();
    expect(inspector.getByText('Optional')).toBeInTheDocument();
    for (const name of [connectorField, workflowField]) {
      expect(name.className).not.toContain('uppercase');
      expect(name.closest('.uppercase')).toBeNull();
    }
    expect(
      screen.getByRole('link', { name: '→ Global settings for twilio_verify' }),
    ).toHaveAttribute('href', ADMIN_ROUTES.connectors.root);
    expect(screen.queryByText('Config')).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).getByText('↻ retry')).toBeInTheDocument();
  });

  it('keeps the list search on the breadcrumb and drops version and step', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    renderPage('?search=kyc&version=1&step=verify');
    await findInspectorHeading('verify');

    expect(screen.getByRole('link', { name: 'Workflows' })).toHaveAttribute(
      'href',
      '/workflows?search=kyc',
    );
  });

  it('links to onboardings filtered by workflow only, whatever version is shown', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published'], [1, 'retired']));
    renderPage('?version=1&step=verify');
    await findInspectorHeading('verify');

    expect(screen.getByRole('link', { name: /View onboardings/ })).toHaveAttribute(
      'href',
      `${ADMIN_ROUTES.onboardings.root}?workflowId=${WORKFLOW_ID}`,
    );
  });

  it('shows not-found for an unknown workflow', async () => {
    mockedFetchVersions.mockRejectedValue(
      new ApiError('Request failed with status 404.', { status: 404 }),
    );
    renderPage();

    expect(await screen.findByText('Workflow kyc not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to workflows/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View onboardings/ })).not.toBeInTheDocument();
  });

  it('shows the failure with a Retry when the versions cannot be read', async () => {
    mockedFetchVersions.mockRejectedValueOnce(
      new ApiError('Request failed with status 500.', { status: 500 }),
    );
    renderPage();

    expect(await screen.findByText(/Unable to load workflow: Request failed/)).toBeInTheDocument();

    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await findInspectorHeading('collect')).toBeInTheDocument();
  });

  it('keeps the header and picker when only the definition fails', async () => {
    mockedFetchVersions.mockResolvedValue(versions([2, 'published']));
    mockedFetchDefinition.mockRejectedValue(
      new ApiError('Request failed with status 500.', { status: 500 }),
    );
    renderPage();

    expect(await screen.findByText(/Unable to load this version/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Version' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  describe('a draft version', () => {
    const draftDocument: WorkflowDraftDocument = {
      workflowId: WORKFLOW_ID,
      version: 3,
      status: 'draft',
      name: 'KYC draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T10:30:00.000Z',
      document: { id: WORKFLOW_ID, version: 3, steps: [] },
    };

    it('renders the editor, not the graph, and never reads the compiled definition', async () => {
      mockedFetchVersions.mockResolvedValue(versions([2, 'published'], [3, 'draft']));
      mockedFetchDocument.mockResolvedValue(draftDocument);
      renderPage('?version=3');

      expect(
        await screen.findByRole('textbox', { name: 'Workflow document (JSON)' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'KYC draft' })).toBeInTheDocument();
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
      expect(document.querySelector('.react-flow')).toBeNull();
      expect(mockedFetchDefinition).not.toHaveBeenCalled();
      expect(mockedFetchDocument).toHaveBeenCalledWith(WORKFLOW_ID, 3);
    });

    it('opens the draft without ?version= when the family has no published version', async () => {
      mockedFetchVersions.mockResolvedValue(versions([3, 'draft'], [1, 'retired']));
      mockedFetchDocument.mockResolvedValue(draftDocument);
      renderPage();

      expect(
        await screen.findByRole('textbox', { name: 'Workflow document (JSON)' }),
      ).toBeInTheDocument();
      expect(mockedFetchDocument).toHaveBeenCalledWith(WORKFLOW_ID, 3);
    });

    it('still renders the graph for a published version', async () => {
      mockedFetchVersions.mockResolvedValue(versions([2, 'published'], [3, 'draft']));
      renderPage('?version=2');

      expect(await findInspectorHeading('collect')).toBeInTheDocument();
      expect(mockedFetchDocument).not.toHaveBeenCalled();
    });
  });
});
