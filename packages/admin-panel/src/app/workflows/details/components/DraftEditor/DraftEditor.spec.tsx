import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Fragment, StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/services/api/api-error';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import {
  createBrowserRouter,
  Outlet,
  RouterProvider,
  useLocation,
  type DataRouter,
} from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compileWorkflowDocument,
  deleteWorkflowDraft,
  fetchWorkflowDocument,
  publishWorkflowDraft,
  updateWorkflowDraft,
  type WorkflowDraft,
  type WorkflowVersionDocument,
} from '@/api/workflows/workflow-drafts';
import {
  fetchWorkflowDefinition,
  type WorkflowDefinition,
} from '@/api/workflows/workflow-definitions';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ADMIN_ROUTES } from '@/constants/routes';
import { DRAFT_ERROR_MESSAGES } from '../../../constants/draft-messages';
import { DraftEditor } from './DraftEditor';

vi.mock('@/api/workflows/workflow-definitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-definitions')>();
  return { ...actual, fetchWorkflowDefinition: vi.fn() };
});

vi.mock('@/api/workflows/workflow-drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-drafts')>();
  return {
    ...actual,
    fetchWorkflowDocument: vi.fn(),
    updateWorkflowDraft: vi.fn(),
    deleteWorkflowDraft: vi.fn(),
    compileWorkflowDocument: vi.fn(),
    publishWorkflowDraft: vi.fn(),
  };
});

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock('../JsonEditor', () => ({
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
const mockedDefinition = vi.mocked(fetchWorkflowDefinition);
const mockedUpdate = vi.mocked(updateWorkflowDraft);
const mockedDelete = vi.mocked(deleteWorkflowDraft);
const mockedCompile = vi.mocked(compileWorkflowDocument);
const mockedPublish = vi.mocked(publishWorkflowDraft);

const WORKFLOW_ID = 'kyc';
const VERSION = 2;
const DOCUMENT = { id: WORKFLOW_ID, version: VERSION, steps: [] };
const SAVED_TEXT = JSON.stringify(DOCUMENT, null, 2);

function stepOf(name: string): WorkflowDefinition['steps'][number] {
  return {
    name,
    status: 'awaiting_user',
    terminal: false,
    transitions: [],
    source: null,
    fields: [],
    connectors: [],
  };
}

const WORKFLOW: WorkflowDefinition = {
  workflowId: WORKFLOW_ID,
  workflowVersion: VERSION,
  name: null,
  initialStep: 'collect',
  scores: {},
  webhook: null,
  steps: [stepOf('collect'), stepOf('verify')],
};

const COMPILATION = { stepCount: 2, workflow: WORKFLOW };

const DRAFT: WorkflowVersionDocument = {
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
    status: 'draft',
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
function AtStartingUrl({
  children,
  gated,
}: {
  children: React.ReactElement;
  gated: boolean;
}): React.ReactElement | null {
  const { pathname, search } = useLocation();
  return !gated || `${pathname}${search}` === startingUrl ? children : null;
}

let client: QueryClient;
let startingUrl = STARTING_URL;
let router: DataRouter | null = null;

// A draft opens on the canvas; most of these specs drive the JSON editor, so they start there unless a view is given.
function renderEditor({
  staysMounted = false,
  search = '',
  strict = false,
  view = 'json',
}: { staysMounted?: boolean; search?: string; strict?: boolean; view?: string | null } = {}): void {
  const viewParam = view === null || search.includes('view=') ? '' : `&view=${view}`;
  startingUrl = `${STARTING_URL}${search}${viewParam}`;
  window.history.replaceState({}, '', startingUrl);
  const Root = strict ? StrictMode : Fragment;
  router = createBrowserRouter([
    {
      element: (
        <NuqsAdapter>
          <Location />
          <Outlet />
        </NuqsAdapter>
      ),
      children: [
        {
          path: ADMIN_ROUTES.workflows.detailsPattern,
          element: (
            <AtStartingUrl gated={!staysMounted}>
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
          ),
        },
        // Where a write leaves for, so the location stays readable after the editor is gone.
        { path: '*', element: null },
      ],
    },
  ]);
  render(
    <Root>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Root>,
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
  client = createQueryClient();
  mockedFetch.mockResolvedValue(DRAFT);
});

afterEach(() => {
  cleanup();
  router?.dispose();
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

    expect(screen.getByText('Unsaved changes · save to publish')).toBeInTheDocument();
    expect(screen.queryByText(/Editing · draft saved/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
    expect(screen.getByText(/Editing · draft saved/)).toBeInTheDocument();
  });

  describe('Authored graph tab', () => {
    it('is the tab a draft opens on', async () => {
      renderEditor({ view: null, staysMounted: true });

      const tab = await screen.findByRole('tab', { name: 'Authored graph' });
      expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText(/No steps yet/)).toBeInTheDocument();
      expect(mockedCompile).not.toHaveBeenCalled();
    });

    it('marks the editor dirty on a canvas edit, shows it in JSON, and undoes it', async () => {
      renderEditor({ view: null, staysMounted: true });
      await userEvent.click(await screen.findByRole('button', { name: /^terminal/ }));

      expect(screen.getByText('Unsaved changes · save to publish')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'JSON' }));
      expect((await editorText()).value).toContain('"name": "terminal_1"');

      await userEvent.click(screen.getByRole('tab', { name: 'Authored graph' }));
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

      expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'JSON' }));
      expect((await editorText()).value).toBe(SAVED_TEXT);
    });

    it('asks to fix the JSON instead of drawing text that is not a document', async () => {
      renderEditor({ staysMounted: true });
      type(await editorText(), '{"steps":');
      await userEvent.click(screen.getByRole('tab', { name: 'Authored graph' }));

      expect(await screen.findByText(/Fix the JSON to see the canvas/)).toBeInTheDocument();
      expect(screen.queryByText(/No steps yet/)).not.toBeInTheDocument();
    });
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
      mockedCompile.mockResolvedValue({ ...COMPILATION, stepCount: 3 });
      renderEditor();
      await editorText();
      await userEvent.click(screen.getByRole('button', { name: 'Validate' }));

      expect(await screen.findByText('Valid · 3 steps')).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledWith(DOCUMENT);
    });

    it('shows the code, reason and path of a refusal, and clears them on the next edit', async () => {
      mockedCompile.mockRejectedValue(
        new ApiError('WORKFLOW_INVALID', {
          status: 400,
          code: 'WORKFLOW_INVALID',
          body: {
            code: 'WORKFLOW_INVALID',
            message: 'WORKFLOW_INVALID',
            reason: 'DUPLICATE_STEP',
            path: 'steps[1]',
          },
        }),
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

  describe('Graph tab', () => {
    const SYNTAX_ERROR_TEXT = '{"id":';

    async function openGraph(): Promise<void> {
      await userEvent.click(screen.getByRole('tab', { name: 'Compiled graph' }));
    }

    async function openJson(): Promise<void> {
      await userEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    }

    function compileFailure(): ApiError {
      return new ApiError('WORKFLOW_INVALID', {
        status: 400,
        code: 'WORKFLOW_INVALID',
        body: { code: 'WORKFLOW_INVALID', message: 'WORKFLOW_INVALID', reason: 'DUPLICATE_STEP' },
      });
    }

    beforeEach(() => {
      mockedCompile.mockResolvedValue(COMPILATION);
    });

    it('compiles the current text once on opening and renders the inspector without stats', async () => {
      renderEditor({ staysMounted: true });
      await editorText();
      await openGraph();

      expect(
        await within(await screen.findByRole('complementary')).findByRole('heading', {
          name: 'collect',
        }),
      ).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledTimes(1);
      expect(mockedCompile).toHaveBeenCalledWith(DOCUMENT);
      expect(screen.queryByText('Stats')).not.toBeInTheDocument();
    });

    it('shows the zoom controls on the draft graph canvas', async () => {
      renderEditor({ staysMounted: true });
      await editorText();
      await openGraph();
      await screen.findByRole('complementary');

      const canvas = document.querySelector('.react-flow') as HTMLElement;
      for (const name of ['Zoom out', 'Zoom in', 'Fit']) {
        expect(within(canvas).getByRole('button', { name })).toBeInTheDocument();
      }
    });

    it('sends no second compile for Graph, JSON, Graph without an edit', async () => {
      renderEditor({ staysMounted: true });
      await editorText();
      await openGraph();
      await screen.findByRole('complementary');
      await openJson();
      await openGraph();

      expect(await screen.findByRole('complementary')).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledTimes(1);
    });

    it('compiles again after an edit', async () => {
      renderEditor({ staysMounted: true });
      const textarea = await editorText();
      await openGraph();
      await screen.findByRole('complementary');
      await openJson();
      type(textarea, `${SAVED_TEXT} `);
      await openGraph();

      await waitFor(() => expect(mockedCompile).toHaveBeenCalledTimes(2));
    });

    it('sends no second compile after Validate', async () => {
      renderEditor({ staysMounted: true });
      await editorText();
      await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
      await screen.findByText('Valid · 2 steps');
      await openGraph();

      expect(await screen.findByRole('complementary')).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledTimes(1);
    });

    it('shows the error state on a failed compile, with the details above the tabs and a way back to JSON', async () => {
      mockedCompile.mockRejectedValue(compileFailure());
      renderEditor({ staysMounted: true });
      await editorText();
      await openGraph();

      expect(
        await screen.findByText('This draft does not compile. Fix it on the JSON tab.'),
      ).toBeInTheDocument();
      const details = screen.getByText('DUPLICATE_STEP');
      expect(details.compareDocumentPosition(screen.getByRole('tablist'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Show JSON' }));

      expect(screen.getByRole('tab', { name: 'JSON' })).toHaveAttribute('aria-selected', 'true');
    });

    it('offers a Retry, not the compile error state, when the compile request fails', async () => {
      mockedCompile.mockRejectedValueOnce(new ApiError('boom', { status: 500 }));
      renderEditor({ staysMounted: true });
      await editorText();
      await openGraph();

      expect(await screen.findByText('Unable to compile this draft: boom')).toBeInTheDocument();
      expect(
        screen.queryByText('This draft does not compile. Fix it on the JSON tab.'),
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('complementary')).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledTimes(2);
    });

    it('shows the error state for a syntax error and sends no request', async () => {
      renderEditor({ staysMounted: true });
      type(await editorText(), SYNTAX_ERROR_TEXT);
      await openGraph();

      expect(
        await screen.findByText('This draft does not compile. Fix it on the JSON tab.'),
      ).toBeInTheDocument();
      expect(screen.getByText(/Invalid JSON:/)).toBeInTheDocument();
      expect(mockedCompile).not.toHaveBeenCalled();
    });

    it('compiles straight away when mounted with ?view=graph', async () => {
      renderEditor({ staysMounted: true, search: '&view=graph' });

      expect(await screen.findByRole('complementary')).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledTimes(1);
    });

    it('sends one compile under StrictMode when mounted with ?view=graph', async () => {
      renderEditor({ staysMounted: true, search: '&view=graph', strict: true });

      expect(await screen.findByRole('complementary')).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledTimes(1);
    });

    it('keeps unsaved text across Graph and back to JSON', async () => {
      renderEditor({ staysMounted: true });
      const textarea = await editorText();
      type(textarea, `${SAVED_TEXT} `);
      await openGraph();
      await screen.findByRole('complementary');
      await openJson();

      expect((await editorText()).value).toBe(`${SAVED_TEXT} `);
    });

    it('shows the header actions on both tabs', async () => {
      renderEditor({ staysMounted: true });
      await editorText();
      await openGraph();
      await screen.findByRole('complementary');

      for (const name of ['Discard', 'Validate', 'Save draft', 'Publish', 'Delete draft']) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument();
      }
      await openJson();
      expect(screen.getByRole('button', { name: 'Validate' })).toBeInTheDocument();
    });

    it('shows the initial step when ?step names a step the edit removed', async () => {
      renderEditor({ staysMounted: true, search: '&view=graph&step=gone' });

      expect(
        await within(await screen.findByRole('complementary')).findByRole('heading', {
          name: 'collect',
        }),
      ).toBeInTheDocument();
    });

    it('ignores a result that arrives after a further edit', async () => {
      let resolveCompile: (value: typeof COMPILATION) => void = () => undefined;
      mockedCompile.mockReturnValueOnce(new Promise((resolve) => (resolveCompile = resolve)));
      renderEditor({ staysMounted: true });
      const textarea = await editorText();
      await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
      type(textarea, `${SAVED_TEXT} `);
      resolveCompile(COMPILATION);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled());
      expect(screen.queryByText(/^Valid ·/)).not.toBeInTheDocument();
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

      await waitFor(() => expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument());
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
      expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
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

    it('does not refetch the old version while the editor is still mounted after a move', async () => {
      mockedUpdate.mockResolvedValue(summary({ version: 3 }));
      renderEditor({ staysMounted: true });
      type(await editorText(), JSON.stringify({ ...DOCUMENT, version: 3 }));
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

      await waitFor(() =>
        expect(screen.getByLabelText('location')).toHaveTextContent('/workflows/kyc?version=3'),
      );
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('raises an error toast with the message for the code', async () => {
      mockedUpdate.mockRejectedValue(
        new ApiError('WORKFLOW_DRAFT_IN_USE', {
          status: 409,
          code: 'WORKFLOW_DRAFT_IN_USE',
          body: { code: 'WORKFLOW_DRAFT_IN_USE', message: 'WORKFLOW_DRAFT_IN_USE' },
        }),
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
        new ApiError('WORKFLOW_INVALID', {
          status: 400,
          code: 'WORKFLOW_INVALID',
          body: {
            code: 'WORKFLOW_INVALID',
            message: 'WORKFLOW_INVALID',
            reason: 'INVALID_SHAPE',
            path: 'version',
          },
        }),
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

  describe('Publish', () => {
    const PUBLICATION = { ...summary(), status: 'published' as const };

    async function clickPublish(): Promise<void> {
      await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    }

    it('is disabled while dirty and enabled again after Save or Discard', async () => {
      mockedUpdate.mockResolvedValue(summary());
      renderEditor();
      const textarea = await editorText();
      expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();

      type(textarea, `${SAVED_TEXT} `);
      expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
      expect(screen.getByText('Unsaved changes · save to publish')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();

      type(textarea, JSON.stringify({ ...DOCUMENT, name: 'KYC' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled());
    });

    it('opens no dialog on a failed compile and stays enabled so the next click compiles again', async () => {
      mockedCompile
        .mockRejectedValueOnce(
          new ApiError('WORKFLOW_INVALID', {
            status: 400,
            code: 'WORKFLOW_INVALID',
            body: {
              code: 'WORKFLOW_INVALID',
              message: 'WORKFLOW_INVALID',
              reason: 'DUPLICATE_STEP',
            },
          }),
        )
        .mockResolvedValueOnce({ ...COMPILATION, stepCount: 3 });
      renderEditor();
      await editorText();
      await clickPublish();

      expect(await screen.findByText('WORKFLOW_INVALID')).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledWith(DOCUMENT);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();

      await clickPublish();

      expect(await screen.findByRole('dialog', { name: 'Publish kyc v2' })).toBeInTheDocument();
      expect(mockedCompile).toHaveBeenCalledTimes(2);
    });

    it('sends no second compile for Graph while the Publish compile is in flight', async () => {
      mockedCompile.mockReturnValue(new Promise(() => undefined));
      renderEditor({ staysMounted: true });
      await editorText();
      await clickPublish();
      await userEvent.click(screen.getByRole('tab', { name: 'Compiled graph' }));

      expect(mockedCompile).toHaveBeenCalledTimes(1);
    });

    it('opens the dialog on a valid compile', async () => {
      mockedCompile.mockResolvedValue({ ...COMPILATION, stepCount: 3 });
      renderEditor();
      await editorText();
      await clickPublish();

      expect(await screen.findByRole('dialog', { name: 'Publish kyc v2' })).toBeInTheDocument();
      expect(screen.getByText('Valid · 3 steps')).toBeInTheDocument();
    });

    describe('connector note', () => {
      const NOTE =
        'Step `collect` runs sumsub_kyc on v1 (selected). v2 will run its authored veriff_kyc.';
      const WITH_SELECTION: WorkflowDefinition = {
        ...WORKFLOW,
        steps: [
          {
            ...stepOf('collect'),
            connectors: [
              {
                id: 'veriff_kyc',
                authoredId: 'veriff_kyc',
                name: 'Veriff',
                type: 'kyc',
                order: 1,
                canReject: true,
                async: true,
                fieldMapping: {},
                optionalFieldMapping: {},
                selected: false,
                selectableIds: [],
                fallbacks: [],
                versions: [
                  { version: 1, id: 'sumsub_kyc', authoredId: 'veriff_kyc', selected: true },
                ],
              },
            ],
          },
        ],
      };

      it('shows the note from the draft read and keeps Publish enabled', async () => {
        mockedCompile.mockResolvedValue(COMPILATION);
        mockedDefinition.mockResolvedValue(WITH_SELECTION);
        renderEditor();
        await editorText();
        await clickPublish();

        const dialog = await screen.findByRole('dialog');
        expect(await within(dialog).findByText(NOTE)).toBeInTheDocument();
        expect(mockedDefinition).toHaveBeenCalledWith(WORKFLOW_ID, VERSION);
        expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeEnabled();
      });

      it('shows no note while the read is loading', async () => {
        mockedCompile.mockResolvedValue(COMPILATION);
        mockedDefinition.mockReturnValue(new Promise(() => undefined));
        renderEditor();
        await editorText();
        await clickPublish();

        const dialog = await screen.findByRole('dialog');
        expect(dialog).not.toHaveTextContent('runs sumsub_kyc');
        expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeEnabled();
      });

      it('shows no note when the read fails', async () => {
        mockedCompile.mockResolvedValue(COMPILATION);
        mockedDefinition.mockRejectedValue(new Error('boom'));
        renderEditor();
        await editorText();
        await clickPublish();

        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(mockedDefinition).toHaveBeenCalled());
        expect(dialog).not.toHaveTextContent('runs sumsub_kyc');
        expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeEnabled();
      });

      it('removes the pinned detail read after publishing and keeps the document read', async () => {
        mockedCompile.mockResolvedValue(COMPILATION);
        mockedDefinition.mockResolvedValue(WITH_SELECTION);
        mockedPublish.mockResolvedValue(PUBLICATION);
        renderEditor({ search: '&view=json' });
        await editorText();
        await clickPublish();
        const dialog = await screen.findByRole('dialog');
        await within(dialog).findByText(NOTE);
        await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));

        await waitFor(() =>
          expect(showSuccessToast).toHaveBeenCalledWith(`Version ${VERSION} published.`),
        );
        await waitFor(() =>
          expect(
            client.getQueryState(workflowQueries.detail(WORKFLOW_ID, VERSION).queryKey),
          ).toBeUndefined(),
        );
        expect(
          client.getQueryState(workflowQueries.document(WORKFLOW_ID, VERSION).queryKey),
        ).toBeDefined();
      });
    });

    it('publishes the bound draft on confirm, never saves, then toasts and lands on its version', async () => {
      mockedCompile.mockResolvedValue({ ...COMPILATION, stepCount: 3 });
      mockedPublish.mockResolvedValue(PUBLICATION);
      renderEditor();
      await editorText();
      await clickPublish();
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish' }),
      );

      await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(WORKFLOW_ID, VERSION));
      expect(mockedUpdate).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(showSuccessToast).toHaveBeenCalledWith(`Version ${VERSION} published.`),
      );
      expect(mockedFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('location')).toHaveTextContent(
        `/workflows/kyc?version=${VERSION}`,
      );
    });

    it('raises the error toast and closes the dialog when publishing fails', async () => {
      mockedCompile.mockResolvedValue({ ...COMPILATION, stepCount: 3 });
      mockedPublish.mockRejectedValue(
        new ApiError('WORKFLOW_VERSION_NOT_LATEST', {
          status: 409,
          code: 'WORKFLOW_VERSION_NOT_LATEST',
          body: {
            code: 'WORKFLOW_VERSION_NOT_LATEST',
            message: 'WORKFLOW_VERSION_NOT_LATEST',
            workflowId: WORKFLOW_ID,
            version: VERSION,
            latestPublishedVersion: 3,
          },
        }),
      );
      renderEditor();
      await editorText();
      await clickPublish();
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish' }),
      );

      await waitFor(() =>
        expect(showErrorToast).toHaveBeenCalledWith(
          'Unable to publish the draft:',
          DRAFT_ERROR_MESSAGES.WORKFLOW_VERSION_NOT_LATEST,
        ),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(showSuccessToast).not.toHaveBeenCalled();
    });
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
      mockedFetch.mockRejectedValue(
        new ApiError('missing', {
          status: 404,
          code: 'WORKFLOW_NOT_FOUND',
          body: { code: 'WORKFLOW_NOT_FOUND', message: 'missing' },
        }),
      );
      renderEditor();

      expect(await screen.findByText('This draft no longer exists.')).toBeInTheDocument();
    });

    it('refetches the versions instead of opening the editor when the version is no longer a draft', async () => {
      mockedFetch.mockResolvedValue({ ...DRAFT, status: 'published' });
      renderEditor({ staysMounted: true });
      const invalidate = vi.spyOn(client, 'invalidateQueries');

      expect(
        await screen.findByText('This version is no longer a draft. Opening it…'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workflowQueries.versions(WORKFLOW_ID).queryKey,
      });
    });

    it('offers a Retry on any other failure', async () => {
      mockedFetch.mockRejectedValueOnce(new ApiError('boom', { status: 500 }));
      renderEditor();

      expect(await screen.findByText(/Unable to load this draft: boom/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect((await editorText()).value).toBe(SAVED_TEXT);
    });
  });

  describe('leaving with unsaved changes', () => {
    async function editAndLeave(): Promise<void> {
      renderEditor();
      type(await editorText(), JSON.stringify({ ...DOCUMENT, name: 'Edited' }));
      await act(() => router?.navigate(ADMIN_ROUTES.workflows.root));
    }

    it('asks before leaving, and Stay keeps the edits', async () => {
      await editAndLeave();

      expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Stay' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByLabelText('location')).toHaveTextContent(startingUrl);
      expect((await editorText()).value).toContain('Edited');
    });

    it('leaves on Discard and leave', async () => {
      await editAndLeave();

      await userEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }));

      await waitFor(() =>
        expect(screen.getByLabelText('location')).toHaveTextContent(ADMIN_ROUTES.workflows.root),
      );
    });

    it('asks again for an edit made after a save', async () => {
      mockedUpdate.mockResolvedValue(summary());
      renderEditor({ staysMounted: true });
      type(await editorText(), JSON.stringify({ ...DOCUMENT, name: 'Saved' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(showSuccessToast).toHaveBeenCalledWith('Draft saved.'));
      type(await editorText(), JSON.stringify({ ...DOCUMENT, name: 'Edited after save' }));
      await act(() => router?.navigate(ADMIN_ROUTES.workflows.root));

      expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
    });

    it('asks while a validate is still in flight', async () => {
      mockedCompile.mockReturnValue(new Promise(() => undefined));
      renderEditor();
      type(await editorText(), JSON.stringify({ ...DOCUMENT, name: 'Edited' }));
      await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
      await act(() => router?.navigate(ADMIN_ROUTES.workflows.root));

      expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
    });

    it('does not ask when a delete of the edited draft leaves', async () => {
      mockedDelete.mockResolvedValue(undefined);
      renderEditor();
      type(await editorText(), JSON.stringify({ ...DOCUMENT, name: 'Edited' }));
      await userEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
      await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

      await waitFor(() =>
        expect(screen.getByLabelText('location')).toHaveTextContent(/^\/workflows$/),
      );
      expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).toBeNull();
    });

    it('does not ask when switching tab', async () => {
      mockedCompile.mockResolvedValue(COMPILATION);
      renderEditor({ staysMounted: true });
      type(await editorText(), JSON.stringify({ ...DOCUMENT, name: 'Edited' }));
      await userEvent.click(screen.getByRole('tab', { name: 'Compiled graph' }));

      await waitFor(() =>
        expect(screen.getByLabelText('location')).toHaveTextContent('view=compiled'),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('asks the browser before unloading with edits, and not without', async () => {
      const unload = (): boolean => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      renderEditor();
      const editor = await editorText();
      expect(unload()).toBe(false);

      type(editor, JSON.stringify({ ...DOCUMENT, name: 'Edited' }));
      await waitFor(() => expect(unload()).toBe(true));
    });

    it('does not ask without edits', async () => {
      renderEditor();
      await editorText();
      await act(() => router?.navigate(ADMIN_ROUTES.workflows.root));

      expect(screen.getByLabelText('location')).toHaveTextContent(ADMIN_ROUTES.workflows.root);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
