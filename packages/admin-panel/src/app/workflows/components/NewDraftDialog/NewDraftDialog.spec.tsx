import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAdminWorkflows, type AdminWorkflowSummary } from '@/api/workflows/admin-workflows';
import {
  createWorkflowDraft,
  fetchWorkflowDocument,
  type WorkflowDraft,
  type WorkflowVersionDocument,
} from '@/api/workflows/workflow-drafts';
import { fetchWorkflowVersions, type WorkflowVersion } from '@/api/workflows/workflow-versions';
import { ApiError } from '@/services/api/api-error';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { DRAFT_ERROR_MESSAGES } from '../../constants/draft-messages';
import { MAX_DRAFT_VERSION } from '../../constants/new-draft';
import { NewDraftDialog } from './NewDraftDialog';

vi.mock('@/api/workflows/workflow-drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-drafts')>();
  return { ...actual, createWorkflowDraft: vi.fn(), fetchWorkflowDocument: vi.fn() };
});

vi.mock('@/api/workflows/admin-workflows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/admin-workflows')>();
  return { ...actual, fetchAdminWorkflows: vi.fn() };
});

vi.mock('@/api/workflows/workflow-versions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-versions')>();
  return { ...actual, fetchWorkflowVersions: vi.fn() };
});

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

const mockedCreate = vi.mocked(createWorkflowDraft);
const mockedList = vi.mocked(fetchAdminWorkflows);
const mockedVersions = vi.mocked(fetchWorkflowVersions);
const mockedDocument = vi.mocked(fetchWorkflowDocument);

function summary(overrides: Partial<AdminWorkflowSummary>): AdminWorkflowSummary {
  return {
    workflowId: 'kyc',
    name: 'KYC flow',
    scope: 'users',
    servingVersion: 2,
    versionCount: 3,
    draftCount: 0,
    inProgressCount: 0,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

function version(number: number, status: WorkflowVersion['status']): WorkflowVersion {
  return {
    version: number,
    status,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
}

function sourceDocument(
  workflowId: string,
  number: number,
  document: Record<string, unknown>,
): WorkflowVersionDocument {
  return {
    workflowId,
    version: number,
    status: 'published',
    name: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    document,
  };
}

const KYC = summary({});
const BUILT_IN = summary({
  workflowId: 'onboarding',
  name: null,
  scope: 'built-in',
  versionCount: 1,
});
const DRAFT_ONLY = summary({
  workflowId: 'only-draft',
  name: 'Only draft',
  versionCount: 1,
  draftCount: 1,
});
const KYC_VERSIONS = [version(3, 'draft'), version(2, 'published'), version(1, 'retired')];
const KYC_DOCUMENTS: Record<number, Record<string, unknown>> = {
  1: { id: 'kyc', version: 1, name: 'KYC v1', steps: [{ id: 'old' }] },
  2: { id: 'kyc', version: 2, name: 'KYC flow', steps: [{ id: 'a' }] },
};

function listPage(
  records: AdminWorkflowSummary[],
): Awaited<ReturnType<typeof fetchAdminWorkflows>> {
  return { records, pagination: { page: 1, limit: 20, total: records.length, totalPages: 1 } };
}

const CREATED: WorkflowDraft = {
  workflowId: 'my-flow',
  version: 2,
  status: 'draft',
  name: 'My flow',
  createdAt: '2026-10-06T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
};

function Location(): React.ReactElement {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
}

function renderDialog(props: React.ComponentProps<typeof NewDraftDialog> = {}): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/workflows']}>
        <Routes>
          <Route path="*" element={<NewDraftDialog {...props} />} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'New draft' }));
  await screen.findByRole('dialog', { name: 'New draft' });
}

async function chooseEmpty(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('radio', { name: /Empty workflow/ }));
}

beforeEach(() => {
  mockedList.mockReset();
  mockedVersions.mockReset();
  mockedDocument.mockReset();
  mockedList.mockResolvedValue(listPage([KYC, BUILT_IN, DRAFT_ONLY]));
  mockedVersions.mockImplementation((id) =>
    Promise.resolve(id === 'kyc' ? KYC_VERSIONS : [version(1, 'published')]),
  );
  mockedDocument.mockImplementation((id, number) =>
    Promise.resolve(
      sourceDocument(
        id,
        number,
        id === 'kyc'
          ? KYC_DOCUMENTS[number]
          : { id, version: number, name: 'Built-in', steps: [{ id: 'b' }] },
      ),
    ),
  );
  mockedCreate.mockReset();
  vi.mocked(showSuccessToast).mockReset();
  vi.mocked(showErrorToast).mockReset();
});

afterEach(cleanup);

describe('NewDraftDialog', () => {
  it('posts the empty document and opens the new draft', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValueOnce(CREATED);
    renderDialog();
    await openDialog(user);
    await chooseEmpty(user);

    await user.type(screen.getByLabelText(/Workflow ID/), 'my-flow');
    await user.clear(screen.getByLabelText(/Version/));
    await user.type(screen.getByLabelText(/Version/), '2');
    await user.type(screen.getByLabelText('Name'), 'My flow');
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/workflows/my-flow?version=2');
    });
    expect(mockedCreate).toHaveBeenCalledWith({
      id: 'my-flow',
      version: 2,
      name: 'My flow',
      steps: [],
    });
    expect(showSuccessToast).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('omits a blank name from the posted document', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValueOnce(CREATED);
    renderDialog();
    await openDialog(user);
    await chooseEmpty(user);

    await user.type(screen.getByLabelText(/Workflow ID/), 'my-flow');
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    expect(mockedCreate).toHaveBeenCalledWith({ id: 'my-flow', version: 1, steps: [] });
  });

  it('validates the id and version before posting', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await chooseEmpty(user);

    await user.clear(screen.getByLabelText(/Version/));
    await user.type(screen.getByLabelText(/Version/), '0');
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    expect(await screen.findByText('A workflow id is required.')).toBeInTheDocument();
    expect(
      screen.getByText('The version is a whole number from 1 to 2147483647.'),
    ).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('refuses a version past the engine integer range', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await chooseEmpty(user);

    await user.type(screen.getByLabelText(/Workflow ID/), 'my-flow');
    await user.clear(screen.getByLabelText(/Version/));
    await user.type(screen.getByLabelText(/Version/), String(MAX_DRAFT_VERSION + 1));
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    expect(
      await screen.findByText('The version is a whole number from 1 to 2147483647.'),
    ).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('posts an uploaded document with its id and version prefilled', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValueOnce(CREATED);
    renderDialog();
    await openDialog(user);

    await user.click(screen.getByRole('radio', { name: /Upload a definition file/ }));
    const document = { id: 'uploaded', version: 3, steps: [{ id: 'a' }] };
    await user.upload(
      screen.getByLabelText('Definition file'),
      new File([JSON.stringify(document)], 'flow.json', { type: 'application/json' }),
    );

    expect(await screen.findByLabelText(/Workflow ID/)).toHaveValue('uploaded');
    expect(screen.getByLabelText(/Version/)).toHaveValue('3');
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith(document));
  });

  it('posts an uploaded document under the edited id and version', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValueOnce(CREATED);
    renderDialog();
    await openDialog(user);

    await user.click(screen.getByRole('radio', { name: /Upload a definition file/ }));
    await user.upload(
      screen.getByLabelText('Definition file'),
      new File(
        [JSON.stringify({ id: 'uploaded', version: 3, name: 'Uploaded', steps: [{ id: 'a' }] })],
        'flow.json',
        { type: 'application/json' },
      ),
    );
    const idField = await screen.findByLabelText(/Workflow ID/);
    await user.clear(idField);
    await user.type(idField, 'my-flow');
    await user.clear(screen.getByLabelText(/Version/));
    await user.type(screen.getByLabelText(/Version/), '2');
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith({
        id: 'my-flow',
        version: 2,
        name: 'Uploaded',
        steps: [{ id: 'a' }],
      });
    });
  });

  it('validates an edited upload id before posting', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.click(screen.getByRole('radio', { name: /Upload a definition file/ }));
    await user.upload(
      screen.getByLabelText('Definition file'),
      new File([JSON.stringify({ id: 'uploaded', version: 3 })], 'flow.json', {
        type: 'application/json',
      }),
    );
    await user.clear(await screen.findByLabelText(/Workflow ID/));
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    expect(await screen.findByText('A workflow id is required.')).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('shows field validation for an uploaded file without an id and posts nothing', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.click(screen.getByRole('radio', { name: /Upload a definition file/ }));
    await user.upload(
      screen.getByLabelText('Definition file'),
      new File([JSON.stringify({ version: 1 })], 'flow.json', { type: 'application/json' }),
    );
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    expect(await screen.findByText('A workflow id is required.')).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(showErrorToast).not.toHaveBeenCalled();
  });

  it('shows field validation for an uploaded version past the engine integer range', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.click(screen.getByRole('radio', { name: /Upload a definition file/ }));
    await user.upload(
      screen.getByLabelText('Definition file'),
      new File([JSON.stringify({ id: 'flow', version: MAX_DRAFT_VERSION + 1 })], 'flow.json', {
        type: 'application/json',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    expect(
      await screen.findByText('The version is a whole number from 1 to 2147483647.'),
    ).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('asks for a file when Upload is chosen without one', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.click(screen.getByRole('radio', { name: /Upload a definition file/ }));
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    expect(await screen.findByText('Choose a .json file.')).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('raises an error toast and keeps the dialog and its input on a 409', async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValueOnce(
      new ApiError('WORKFLOW_VERSION_EXISTS', {
        status: 409,
        code: 'WORKFLOW_VERSION_EXISTS',
        body: { code: 'WORKFLOW_VERSION_EXISTS', message: 'WORKFLOW_VERSION_EXISTS' },
      }),
    );
    renderDialog();
    await openDialog(user);
    await chooseEmpty(user);

    await user.type(screen.getByLabelText(/Workflow ID/), 'my-flow');
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => {
      expect(showErrorToast).toHaveBeenCalledWith(
        'Could not create the draft',
        DRAFT_ERROR_MESSAGES.WORKFLOW_VERSION_EXISTS,
      );
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('my-flow');
    expect(screen.getByTestId('location')).toHaveTextContent('/workflows');
    expect(showSuccessToast).not.toHaveBeenCalled();
  });

  it('closes on Cancel', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await chooseEmpty(user);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('NewDraftDialog fork', () => {
  async function pickFamily(
    user: ReturnType<typeof userEvent.setup>,
    name: string | RegExp,
  ): Promise<void> {
    await user.click(screen.getByRole('combobox', { name: 'Source workflow' }));
    await user.click(await screen.findByRole('option', { name }));
  }

  it('opens on Fork and lists only families with a non-draft version', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    expect(screen.getByRole('radio', { name: /Fork an existing version/ })).toBeChecked();
    await user.click(screen.getByRole('combobox', { name: 'Source workflow' }));
    expect(await screen.findByRole('option', { name: /KYC flow/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /onboarding/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Only draft/ })).not.toBeInTheDocument();
  });

  function families(
    count: number,
    overrides: Partial<AdminWorkflowSummary>,
  ): AdminWorkflowSummary[] {
    return Array.from({ length: count }, (_, index) =>
      summary({ workflowId: `flow-${index}`, name: `Flow ${index}`, ...overrides }),
    );
  }

  function pagedList(pages: AdminWorkflowSummary[][]): void {
    mockedList.mockImplementation(({ page }) =>
      Promise.resolve({
        records: pages[page - 1],
        pagination: { page, limit: 20, total: pages.flat().length, totalPages: pages.length },
      }),
    );
  }

  const pagesRequested = (): number[] => mockedList.mock.calls.map(([filters]) => filters.page);

  it('reads past a page of draft-only families until forkable ones show', async () => {
    pagedList([families(20, { versionCount: 1, draftCount: 1 }), [KYC]]);
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.click(screen.getByRole('combobox', { name: 'Source workflow' }));

    expect(await screen.findByRole('option', { name: /KYC flow/ })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(pagesRequested()).toEqual([1, 2]);
  });

  it('reads the next page when the list is scrolled to its end', async () => {
    pagedList([families(20, {}), [KYC]]);
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await user.click(screen.getByRole('combobox', { name: 'Source workflow' }));
    await screen.findByRole('option', { name: /Flow 19/ });
    expect(pagesRequested()).toEqual([1]);

    // The popup is the scrolling element around the listbox.
    const popup = screen.getByRole('listbox').parentElement as HTMLElement;
    Object.defineProperties(popup, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 288 },
    });
    popup.scrollTop = 712;
    fireEvent.scroll(popup);

    expect(await screen.findByRole('option', { name: /KYC flow/ })).toBeInTheDocument();
    expect(pagesRequested()).toEqual([1, 2]);
  });

  it('searches the server once, 300 ms after the typing settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderDialog();
      await openDialog(user);

      await user.type(screen.getByRole('combobox', { name: 'Source workflow' }), 'kyc');
      const searchCalls = (): number =>
        mockedList.mock.calls.filter(([filters]) => filters.search === 'kyc').length;
      expect(searchCalls()).toBe(0);

      await act(() => vi.advanceTimersByTimeAsync(300));
      await waitFor(() => expect(searchCalls()).toBe(1));
      expect(mockedList).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'k' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults to the latest published version and prefills a users source', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);

    expect(await screen.findByRole('combobox', { name: 'Source version' })).toHaveTextContent(
      'v2 — published',
    );
    await waitFor(() => expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('kyc'));
    expect(screen.getByLabelText(/^Version/)).toHaveValue('4');
    expect(screen.getByLabelText('Name')).toHaveValue('KYC flow');
    expect(screen.getByLabelText(/Workflow ID/)).toHaveAccessibleDescription(
      'Changing the ID creates a new workflow.',
    );
  });

  it('leaves the ID empty with a hint for a built-in source', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /onboarding/);

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Built-in'));
    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('');
    expect(screen.getByLabelText(/^Version/)).toHaveValue('1');
    expect(screen.getByLabelText(/Workflow ID/)).toHaveAccessibleDescription(
      'Built-in workflows are copied under a new ID.',
    );
  });

  it('prefills again when another version is chosen and keeps the version on an ID edit', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));

    await user.click(screen.getByRole('combobox', { name: 'Source version' }));
    await user.click(await screen.findByRole('option', { name: 'v1 — retired' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC v1'));

    await user.clear(screen.getByLabelText(/Workflow ID/));
    await user.type(screen.getByLabelText(/Workflow ID/), 'kyc-copy');
    expect(screen.getByLabelText(/^Version/)).toHaveValue('4');
  });

  it('keeps edited fields when the operator leaves Fork and comes back', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));
    await user.clear(screen.getByLabelText(/Workflow ID/));
    await user.type(screen.getByLabelText(/Workflow ID/), 'kyc-copy');
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'KYC copy');

    await chooseEmpty(user);
    await user.click(screen.getByRole('radio', { name: /Fork an existing version/ }));

    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('kyc-copy');
    expect(screen.getByLabelText(/^Version/)).toHaveValue('4');
    expect(screen.getByLabelText('Name')).toHaveValue('KYC copy');
  });

  it('clears a read upload and prefills the fork again when the operator returns to Fork', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));

    await user.click(screen.getByRole('radio', { name: /Upload a definition file/ }));
    await user.upload(
      screen.getByLabelText('Definition file'),
      new File([JSON.stringify({ id: 'uploaded', version: 9, name: 'Uploaded' })], 'flow.json', {
        type: 'application/json',
      }),
    );
    await waitFor(() => expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('uploaded'));
    await user.click(screen.getByRole('radio', { name: /Fork an existing version/ }));

    await waitFor(() => expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('kyc'));
    expect(screen.getByLabelText(/^Version/)).toHaveValue('4');
    expect(screen.getByLabelText('Name')).toHaveValue('KYC flow');
    await user.click(screen.getByRole('radio', { name: /Upload a definition file/ }));
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));
    expect(await screen.findByText('Choose a .json file.')).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('keeps the prefill when the selected version is chosen again', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));

    await user.click(screen.getByRole('combobox', { name: 'Source version' }));
    await user.click(await screen.findByRole('option', { name: 'v2 — published' }));

    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('kyc');
    expect(screen.getByLabelText(/^Version/)).toHaveValue('4');
    expect(screen.getByLabelText('Name')).toHaveValue('KYC flow');
  });

  it('keeps the prefill when the selected family is chosen again', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));

    await pickFamily(user, /KYC flow/);

    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('kyc');
    expect(screen.getByLabelText(/^Version/)).toHaveValue('4');
    expect(screen.getByLabelText('Name')).toHaveValue('KYC flow');
  });

  it('prefills again when another family is chosen', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));

    await pickFamily(user, /onboarding/);

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Built-in'));
    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('');
    expect(screen.getByLabelText(/^Version/)).toHaveValue('1');
  });

  it("never searches by the chosen family's label", async () => {
    const LONG_NAME =
      'EU B2C individual KYC — EEA, applicant chooses the document (Veriff, specialized steps, local walkthrough copy)';
    mockedList.mockResolvedValue(listPage([summary({ name: LONG_NAME }), BUILT_IN]));
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await pickFamily(user, /EU B2C individual KYC/);
    await waitFor(() => expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('kyc'));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(screen.getByRole('combobox', { name: 'Source workflow' })).toHaveValue(LONG_NAME);
    expect(mockedList.mock.calls.every(([filters]) => filters.search === null)).toBe(true);
  });

  it("searches with the typed text trimmed and cut to the engine's 100 characters", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    // Pasted, not typed: 122 keystrokes each re-render the combobox and overran the 5 s budget on CI.
    await user.click(screen.getByRole('combobox', { name: 'Source workflow' }));
    await user.paste(` ${'a'.repeat(120)} `);

    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ search: 'a'.repeat(100) })),
    );
    expect(mockedList.mock.calls.every(([filters]) => (filters.search ?? '').length <= 100)).toBe(
      true,
    );
  });

  it('prefills again when the family is cleared and chosen again', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('combobox', { name: 'Source workflow' })).toHaveValue('');
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));
    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('kyc');
  });

  it('prefills again when the last source is chosen before the in-between one loads', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));

    const loaded = mockedDocument.getMockImplementation();
    mockedDocument.mockImplementation((id, number) =>
      number === 1 ? new Promise(() => {}) : loaded!(id, number),
    );
    await user.click(screen.getByRole('combobox', { name: 'Source version' }));
    await user.click(await screen.findByRole('option', { name: 'v1 — retired' }));
    await user.click(screen.getByRole('combobox', { name: 'Source version' }));
    await user.click(await screen.findByRole('option', { name: 'v2 — published' }));

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));
  });

  it('posts the source document under the typed id, version and name', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValueOnce(CREATED);
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));

    await user.clear(screen.getByLabelText(/Workflow ID/));
    await user.type(screen.getByLabelText(/Workflow ID/), 'kyc-copy');
    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith({
        id: 'kyc-copy',
        version: 4,
        steps: [{ id: 'a' }],
      });
    });
  });

  it('shows a draft-exists band and an Open draft action until the ID changes', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);

    const band = await screen.findByRole('status');
    expect(band).toHaveTextContent(
      'This workflow already has draft v3. Open it, or change the ID to create a new workflow.',
    );
    expect(within(band).getByRole('link', { name: 'Open it' })).toHaveAttribute(
      'href',
      '/workflows/kyc?version=3',
    );
    const openDraft = screen.getByRole('link', { name: 'Open draft v3' });
    expect(openDraft).toHaveAttribute('href', '/workflows/kyc?version=3');
    expect(screen.getByRole('button', { name: 'Create and open editor' })).toBeDisabled();

    await user.type(screen.getByLabelText(/Workflow ID/), '-copy');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open draft v3' })).not.toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create and open editor' });
    expect(create).toBeEnabled();
    expect(create).toHaveClass('bg-tsh-black');
  });

  it('closes the dialog and navigates from the band link', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);

    await user.click(
      within(await screen.findByRole('status')).getByRole('link', { name: 'Open it' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent('/workflows/kyc?version=3');
  });

  it('closes the dialog and navigates from the Open draft action', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);

    await user.click(await screen.findByRole('link', { name: 'Open draft v3' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent('/workflows/kyc?version=3');
  });

  it('shows a retry when the source cannot be read', async () => {
    const user = userEvent.setup();
    mockedDocument.mockRejectedValueOnce(new Error('boom'));
    renderDialog();
    await openDialog(user);
    await pickFamily(user, /KYC flow/);

    expect(await screen.findByText('Could not load the source workflow.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC flow'));
  });

  it('prefills the upload name and removes a blank one', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValueOnce(CREATED);
    renderDialog();
    await openDialog(user);

    await user.click(screen.getByRole('radio', { name: /Upload a definition file/ }));
    await user.upload(
      screen.getByLabelText('Definition file'),
      new File(
        [JSON.stringify({ id: 'uploaded', version: 3, name: 'Uploaded', steps: [] })],
        'f.json',
        {
          type: 'application/json',
        },
      ),
    );
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Uploaded');
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith({ id: 'uploaded', version: 3, steps: [] });
    });
  });
});

describe('NewDraftDialog with initialFork', () => {
  it('opens the given version of a users family, prefilled', async () => {
    const user = userEvent.setup();
    renderDialog({ initialFork: { workflowId: 'kyc', version: 1 } });
    await user.click(screen.getByRole('button', { name: 'New draft' }));
    await screen.findByRole('dialog', { name: 'New draft' });

    expect(screen.getByRole('radio', { name: /Fork an existing version/ })).toBeChecked();
    expect(await screen.findByRole('combobox', { name: 'Source version' })).toHaveTextContent(
      'v1 — retired',
    );
    expect(screen.getByRole('combobox', { name: 'Source workflow' })).toHaveValue('KYC flow');
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC v1'));
    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('kyc');
    expect(screen.getByLabelText(/^Version/)).toHaveValue('4');
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, search: 'kyc' }));
  });

  it('opens a built-in family with an empty ID and Version 1', async () => {
    const user = userEvent.setup();
    renderDialog({ initialFork: { workflowId: 'onboarding', version: 1 } });
    await user.click(screen.getByRole('button', { name: 'New draft' }));

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Built-in'));
    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('');
    expect(screen.getByLabelText(/^Version/)).toHaveValue('1');
  });

  it('leaves the combobox empty when no family matches exactly', async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue(listPage([summary({ workflowId: 'kyc-eu' })]));
    renderDialog({ initialFork: { workflowId: 'kyc', version: 1 } });
    await user.click(screen.getByRole('button', { name: 'New draft' }));
    await screen.findByRole('dialog', { name: 'New draft' });

    expect(screen.getByRole('combobox', { name: 'Source workflow' })).toHaveValue('');
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('leaves typed Empty fields alone when the document resolves late', async () => {
    const user = userEvent.setup();
    let resolveDocument: (value: WorkflowVersionDocument) => void = () => undefined;
    mockedDocument.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocument = resolve;
        }),
    );
    renderDialog({ initialFork: { workflowId: 'kyc', version: 1 } });
    await user.click(screen.getByRole('button', { name: 'New draft' }));
    await screen.findByRole('dialog', { name: 'New draft' });
    await waitFor(() => expect(mockedDocument).toHaveBeenCalled());

    await chooseEmpty(user);
    await user.type(screen.getByLabelText(/Workflow ID/), 'mine');
    await act(async () => {
      resolveDocument(sourceDocument('kyc', 1, KYC_DOCUMENTS[1]));
      await Promise.resolve();
    });

    expect(screen.getByLabelText(/Workflow ID/)).toHaveValue('mine');
    expect(screen.getByLabelText(/^Version/)).toHaveValue('1');
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.queryByText('Changing the ID creates a new workflow.')).not.toBeInTheDocument();
  });

  it('shows the loading state and blocks Create while the preselected family is looked up', async () => {
    const user = userEvent.setup();
    let resolveLookup: (page: ReturnType<typeof listPage>) => void = () => undefined;
    mockedList.mockImplementation((filters) =>
      filters.limit === 100
        ? new Promise((resolve) => {
            resolveLookup = resolve;
          })
        : Promise.resolve(listPage([KYC])),
    );
    renderDialog({ initialFork: { workflowId: 'kyc', version: 1 } });
    await user.click(screen.getByRole('button', { name: 'New draft' }));
    await screen.findByRole('dialog', { name: 'New draft' });

    expect(screen.getByRole('button', { name: 'Create and open editor' })).toBeDisabled();
    expect(screen.getByLabelText(/Workflow ID/)).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Source workflow' }));
    await waitFor(() => {
      const rows = screen.getAllByRole('status').map((row) => row.textContent);
      expect(rows).toContain('Loading…');
    });
    await user.keyboard('{Escape}');

    await act(async () => {
      resolveLookup(listPage([KYC]));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('KYC v1'));
    expect(screen.getByRole('button', { name: 'Create and open editor' })).toBeDisabled();
  });
});
