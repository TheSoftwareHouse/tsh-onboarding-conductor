import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compileWorkflowDocument,
  deleteWorkflowDraft,
  fetchWorkflowDocument,
  updateWorkflowDraft,
  WorkflowDraftError,
  type WorkflowDraft,
  type WorkflowDraftDocument,
} from '@/api/workflows/workflow-drafts';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ADMIN_ROUTES } from '@/constants/routes';
import { DRAFT_ERROR_MESSAGES } from '../../../constants/draft-messages';
import { DraftEditor } from './DraftEditor';

vi.mock('@/api/workflows/workflow-drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-drafts')>();
  return {
    ...actual,
    fetchWorkflowDocument: vi.fn(),
    updateWorkflowDraft: vi.fn(),
    deleteWorkflowDraft: vi.fn(),
    compileWorkflowDocument: vi.fn(),
  };
});

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock('./JsonEditor', () => ({
  JsonEditor: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
  }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

const mockedFetch = vi.mocked(fetchWorkflowDocument);
const mockedUpdate = vi.mocked(updateWorkflowDraft);
const mockedDelete = vi.mocked(deleteWorkflowDraft);
const mockedCompile = vi.mocked(compileWorkflowDocument);

const WORKFLOW_ID = 'kyc';
const VERSION = 2;
const DOCUMENT = { id: WORKFLOW_ID, version: VERSION, steps: [] };
const SAVED_TEXT = JSON.stringify(DOCUMENT, null, 2);

const DRAFT: WorkflowDraftDocument = {
  workflowId: WORKFLOW_ID,
  version: VERSION,
  status: 'draft',
  name: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T10:30:00.000Z',
  document: DOCUMENT,
};

function summary(overrides: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    workflowId: DRAFT.workflowId,
    version: DRAFT.version,
    status: DRAFT.status,
    name: DRAFT.name,
    createdAt: DRAFT.createdAt,
    updatedAt: DRAFT.updatedAt,
    ...overrides,
  };
}

function Location(): React.ReactElement {
  const { pathname, search } = useLocation();
  return <output aria-label="location">{`${pathname}${search}`}</output>;
}

const STARTING_URL = `/workflows/${WORKFLOW_ID}?version=${VERSION}`;

// The page remounts the editor per version, so once a write navigates away the editor is gone, as here.
function AtStartingUrl({ children }: { children: React.ReactElement }): React.ReactElement | null {
  const { pathname, search } = useLocation();
  return `${pathname}${search}` === STARTING_URL ? children : null;
}

let client: QueryClient;

function renderEditor(): void {
  window.history.replaceState({}, '', STARTING_URL);
  render(
    <BrowserRouter>
      <QueryClientProvider client={client}>
        <Location />
        <Routes>
          <Route
            path={ADMIN_ROUTES.workflows.detailsPattern}
            element={
              <AtStartingUrl>
                <DraftEditor
                  workflowId={WORKFLOW_ID}
                  version={VERSION}
                  renderHeader={({ actions, note }) => (
                    <header>
                      {note}
                      {actions}
                    </header>
                  )}
                />
              </AtStartingUrl>
            }
          />
        </Routes>
      </QueryClientProvider>
    </BrowserRouter>,
  );
}

async function editorText(): Promise<HTMLTextAreaElement> {
  return (await screen.findByRole('textbox', {
    name: 'Workflow document (JSON)',
  })) as HTMLTextAreaElement;
}

function type(textarea: HTMLTextAreaElement, text: string): void {
  fireEvent.change(textarea, { target: { value: text } });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockedFetch.mockResolvedValue(DRAFT);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DraftEditor', () => {
  it('shows the saved document and when it was saved, with Discard and Save disabled while clean', async () => {
    renderEditor();

    expect((await editorText()).value).toBe(SAVED_TEXT);
    expect(screen.getByText(/Editing · draft saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled();
  });

  it('shows Unsaved changes while the text differs from the saved document, and clears it on Discard', async () => {
    renderEditor();
    type(await editorText(), `${SAVED_TEXT} `);

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.queryByText(/Editing · draft saved/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByText(/Editing · draft saved/)).toBeInTheDocument();
  });

  describe('Validate', () => {
    it('shows a JSON syntax error without calling the engine', async () => {
      renderEditor();
      type(await editorText(), '{"id":');
      await userEvent.click(screen.getByRole('button', { name: 'Validate' }));

      expect(await screen.findByText(/Invalid JSON:/)).toBeInTheDocument();
      expect(mockedCompile).not.toHaveBeenCalled();
    });

    it('shows how many steps a valid document has', async () => {
      mockedCompile.mockResolvedValue({ stepCount: 3 });
      renderEditor();
      await editorText();
      await userEvent.click(screen.getByRole('button', { name: 'Validate' }));

      expect(await screen.findByText('Valid · 3 steps')).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledWith(DOCUMENT);
    });

    it('shows the code, reason and path of a refusal, and clears them on the next edit', async () => {
      mockedCompile.mockRejectedValue(
        new WorkflowDraftError(
          'WORKFLOW_INVALID',
          400,
          'WORKFLOW_INVALID',
          'DUPLICATE_STEP',
          'steps[1]',
        ),
      );
      renderEditor();
      const textarea = await editorText();
      await userEvent.click(screen.getByRole('button', { name: 'Validate' }));

      expect(await screen.findByText('WORKFLOW_INVALID')).toBeInTheDocument();
      expect(screen.getByText('DUPLICATE_STEP · steps[1]')).toBeInTheDocument();
      expect(screen.getByText(DRAFT_ERROR_MESSAGES.WORKFLOW_INVALID)).toBeInTheDocument();

      type(textarea, `${SAVED_TEXT} `);

      expect(screen.queryByText('WORKFLOW_INVALID')).not.toBeInTheDocument();
    });
  });

  describe('Save draft', () => {
    it('sends nothing when the text is not JSON', async () => {
      renderEditor();
      type(await editorText(), 'nope');
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      expect(await screen.findByText(/Invalid JSON:/)).toBeInTheDocument();
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it('sends the document, raises a toast and stays put when the draft did not move', async () => {
      mockedUpdate.mockResolvedValue(summary());
      renderEditor();
      const textarea = await editorText();
      const edited = JSON.stringify({ ...DOCUMENT, name: 'KYC' });
      type(textarea, edited);
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      await waitFor(() => expect(showSuccessToast).toHaveBeenCalledWith('Draft saved.'));
      expect(mockedUpdate).toHaveBeenCalledWith(WORKFLOW_ID, VERSION, { ...DOCUMENT, name: 'KYC' });
      expect(screen.getByLabelText('location')).toHaveTextContent(
        `/workflows/kyc?version=${VERSION}`,
      );
    });

    it('clears Unsaved changes once the sent text is saved', async () => {
      mockedUpdate.mockResolvedValue(summary());
      renderEditor();
      type(await editorText(), JSON.stringify({ ...DOCUMENT, name: 'KYC' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    });

    it('keeps text typed while the save was in flight', async () => {
      let resolveSave: (draft: WorkflowDraft) => void = () => undefined;
      mockedUpdate.mockReturnValue(new Promise((resolve) => (resolveSave = resolve)));
      renderEditor();
      const textarea = await editorText();
      type(textarea, JSON.stringify({ ...DOCUMENT, name: 'KYC' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      const newer = JSON.stringify({ ...DOCUMENT, name: 'KYC 2' });
      type(textarea, newer);
      resolveSave(summary());

      await waitFor(() => expect(showSuccessToast).toHaveBeenCalledWith('Draft saved.'));
      expect(textarea.value).toBe(newer);
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('navigates to the new id and version when the draft moved', async () => {
      mockedUpdate.mockResolvedValue(summary({ workflowId: 'kyc-eu', version: 1 }));
      renderEditor();
      type(await editorText(), JSON.stringify({ ...DOCUMENT, id: 'kyc-eu', version: 1 }));
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      await waitFor(() =>
        expect(screen.getByLabelText('location')).toHaveTextContent('/workflows/kyc-eu?version=1'),
      );
    });

    it("invalidates only the saved version's reads, not its family's other versions", async () => {
      mockedUpdate.mockResolvedValue(summary());
      client.setQueryData(workflowQueries.detail(WORKFLOW_ID, 1).queryKey, {} as never);
      renderEditor();
      type(await editorText(), JSON.stringify({ ...DOCUMENT, name: 'Renamed' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
      expect(
        client.getQueryState(workflowQueries.detail(WORKFLOW_ID, 1).queryKey)?.isInvalidated,
      ).toBe(false);
    });

    it('drops the old family from the cache, unfetched, when a rename emptied it', async () => {
      mockedUpdate.mockResolvedValue(summary({ workflowId: 'kyc-eu' }));
      client.setQueryData(workflowQueries.versions(WORKFLOW_ID).queryKey, [
        { version: VERSION, status: 'draft', createdAt: '', updatedAt: '' },
      ]);
      renderEditor();
      type(await editorText(), JSON.stringify({ ...DOCUMENT, id: 'kyc-eu' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      await waitFor(() =>
        expect(screen.getByLabelText('location')).toHaveTextContent('/workflows/kyc-eu?version=2'),
      );
      expect(
        client.getQueryCache().findAll({ queryKey: workflowQueries.detailsFor(WORKFLOW_ID) }),
      ).toEqual([]);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('drops only the old version when the draft moves within its family', async () => {
      mockedUpdate.mockResolvedValue(summary({ version: 3 }));
      client.setQueryData(workflowQueries.versions(WORKFLOW_ID).queryKey, [
        { version: 1, status: 'published', createdAt: '', updatedAt: '' },
        { version: VERSION, status: 'draft', createdAt: '', updatedAt: '' },
      ]);
      renderEditor();
      type(await editorText(), JSON.stringify({ ...DOCUMENT, version: 3 }));
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      await waitFor(() =>
        expect(screen.getByLabelText('location')).toHaveTextContent('/workflows/kyc?version=3'),
      );
      expect(
        client.getQueryState(workflowQueries.document(WORKFLOW_ID, VERSION).queryKey),
      ).toBeUndefined();
      expect(client.getQueryState(workflowQueries.versions(WORKFLOW_ID).queryKey)).toBeDefined();
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('raises an error toast with the message for the code', async () => {
      mockedUpdate.mockRejectedValue(
        new WorkflowDraftError('WORKFLOW_DRAFT_IN_USE', 409, 'WORKFLOW_DRAFT_IN_USE'),
      );
      renderEditor();
      type(await editorText(), `${SAVED_TEXT} `);
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      await waitFor(() =>
        expect(showErrorToast).toHaveBeenCalledWith(
          expect.any(String),
          DRAFT_ERROR_MESSAGES.WORKFLOW_DRAFT_IN_USE,
        ),
      );
    });

    it('includes the engine reason and path in the error toast', async () => {
      mockedUpdate.mockRejectedValue(
        new WorkflowDraftError(
          'WORKFLOW_INVALID',
          400,
          'WORKFLOW_INVALID',
          'INVALID_SHAPE',
          'version',
        ),
      );
      renderEditor();
      type(await editorText(), `${SAVED_TEXT} `);
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      await waitFor(() =>
        expect(showErrorToast).toHaveBeenCalledWith(
          expect.any(String),
          `${DRAFT_ERROR_MESSAGES.WORKFLOW_INVALID} (INVALID_SHAPE at version)`,
        ),
      );
    });
  });

  it('restores the saved text on Discard', async () => {
    renderEditor();
    const textarea = await editorText();
    type(textarea, '{}');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(textarea.value).toBe(SAVED_TEXT);
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  describe('Delete draft', () => {
    it('needs two clicks, then leaves for the list when the family has no other version', async () => {
      mockedDelete.mockResolvedValue(undefined);
      renderEditor();
      await editorText();

      await userEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
      expect(mockedDelete).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

      await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(WORKFLOW_ID, VERSION));
      expect(showSuccessToast).toHaveBeenCalledWith('Draft deleted.');
      await waitFor(() =>
        expect(screen.getByLabelText('location')).toHaveTextContent(/^\/workflows$/),
      );
      expect(
        client.getQueryCache().findAll({ queryKey: workflowQueries.detailsFor(WORKFLOW_ID) }),
      ).toEqual([]);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('leaves for the workflow when other versions remain', async () => {
      mockedDelete.mockResolvedValue(undefined);
      client.setQueryData(workflowQueries.versions(WORKFLOW_ID).queryKey, [
        { version: 1, status: 'published', createdAt: '', updatedAt: '' },
        { version: VERSION, status: 'draft', createdAt: '', updatedAt: '' },
      ]);
      renderEditor();
      await editorText();
      await userEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
      await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

      await waitFor(() =>
        expect(screen.getByLabelText('location')).toHaveTextContent(/^\/workflows\/kyc$/),
      );
      expect(
        client.getQueryState(workflowQueries.document(WORKFLOW_ID, VERSION).queryKey),
      ).toBeUndefined();
      expect(client.getQueryState(workflowQueries.versions(WORKFLOW_ID).queryKey)).toBeDefined();
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('lets the operator back out of the confirm', async () => {
      renderEditor();
      await editorText();
      await userEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.getByRole('button', { name: 'Delete draft' })).toBeInTheDocument();
      expect(mockedDelete).not.toHaveBeenCalled();
    });
  });

  describe('reading the draft', () => {
    it('says the draft is gone on a 404', async () => {
      mockedFetch.mockRejectedValue(new WorkflowDraftError('missing', 404, 'WORKFLOW_NOT_FOUND'));
      renderEditor();

      expect(await screen.findByText('This draft no longer exists.')).toBeInTheDocument();
    });

    it('says the version is no longer a draft on a 409', async () => {
      mockedFetch.mockRejectedValue(
        new WorkflowDraftError('published', 409, 'WORKFLOW_VERSION_NOT_DRAFT'),
      );
      renderEditor();

      expect(await screen.findByText('This version is no longer a draft.')).toBeInTheDocument();
    });

    it('offers a Retry on any other failure', async () => {
      mockedFetch.mockRejectedValueOnce(new WorkflowDraftError('boom', 500));
      renderEditor();

      expect(await screen.findByText(/Unable to load this draft: boom/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect((await editorText()).value).toBe(SAVED_TEXT);
    });
  });
});
