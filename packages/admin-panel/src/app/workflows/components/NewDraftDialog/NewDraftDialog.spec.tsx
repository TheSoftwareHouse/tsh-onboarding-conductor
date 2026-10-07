import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkflowDraft,
  WorkflowDraftError,
  type WorkflowDraft,
} from '@/api/workflows/workflow-drafts';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { DRAFT_ERROR_MESSAGES } from '../../constants/draft-messages';
import { MAX_DRAFT_VERSION } from '../../constants/new-draft';
import { NewDraftDialog } from './NewDraftDialog';

vi.mock('@/api/workflows/workflow-drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-drafts')>();
  return { ...actual, createWorkflowDraft: vi.fn() };
});

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

const mockedCreate = vi.mocked(createWorkflowDraft);

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

function renderDialog(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/workflows']}>
        <Routes>
          <Route path="*" element={<NewDraftDialog />} />
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

beforeEach(() => {
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

    await user.type(screen.getByLabelText(/Workflow ID/), 'my-flow');
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    expect(mockedCreate).toHaveBeenCalledWith({ id: 'my-flow', version: 1, steps: [] });
  });

  it('validates the id and version before posting', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

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

    await user.type(screen.getByLabelText(/Workflow ID/), 'my-flow');
    await user.clear(screen.getByLabelText(/Version/));
    await user.type(screen.getByLabelText(/Version/), String(MAX_DRAFT_VERSION + 1));
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    expect(
      await screen.findByText('The version is a whole number from 1 to 2147483647.'),
    ).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('posts an uploaded document and shows its id and version read-only', async () => {
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

    expect(await screen.findByDisplayValue('uploaded')).toHaveAttribute('readonly');
    expect(screen.getByDisplayValue('3')).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith(document));
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
      new WorkflowDraftError('WORKFLOW_VERSION_EXISTS', 409, 'WORKFLOW_VERSION_EXISTS'),
    );
    renderDialog();
    await openDialog(user);

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

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
