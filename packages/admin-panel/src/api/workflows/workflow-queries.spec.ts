import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workflowQueries } from './workflow-queries';
import {
  fetchAdminWorkflows,
  type AdminWorkflowQueryFilters,
  type AdminWorkflowsPage,
} from './admin-workflows';
import { fetchWorkflowDefinition, type WorkflowDefinition } from './workflow-definitions';

vi.mock('./admin-workflows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-workflows')>()),
  fetchAdminWorkflows: vi.fn(),
}));

vi.mock('./workflow-definitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflow-definitions')>()),
  fetchWorkflowDefinition: vi.fn(),
}));

const mockedFetchAdminWorkflows = vi.mocked(fetchAdminWorkflows);
const mockedFetchWorkflowDefinition = vi.mocked(fetchWorkflowDefinition);

const DEFINITION: WorkflowDefinition = {
  workflowId: 'kyc',
  workflowVersion: 3,
  name: null,
  initialStep: 'collect_documents',
  scores: {},
  steps: [],
};

const WORKFLOWS_PAGE: AdminWorkflowsPage = {
  records: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

const FILTERS: AdminWorkflowQueryFilters = {
  page: 1,
  limit: 20,
  search: null,
  scope: null,
  hasDraft: null,
};

beforeEach(() => {
  mockedFetchAdminWorkflows.mockReset();
  mockedFetchAdminWorkflows.mockResolvedValue(WORKFLOWS_PAGE);
  mockedFetchWorkflowDefinition.mockReset();
  mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workflowQueries', () => {
  it('builds the key hierarchy exactly as pinned', () => {
    expect(workflowQueries.all()).toEqual(['workflows']);
    expect(workflowQueries.lists()).toEqual(['workflows', 'list']);
    expect(workflowQueries.list(FILTERS).queryKey).toEqual(['workflows', 'list', FILTERS]);
    expect(workflowQueries.details()).toEqual(['workflows', 'details']);
    expect(workflowQueries.detail('kyc', 3).queryKey).toEqual(['workflows', 'details', 'kyc', 3]);
  });

  it('fetches the list with the same filters the key was built from, across the module boundary', async () => {
    const options = workflowQueries.list(FILTERS);

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchAdminWorkflows).toHaveBeenCalledWith(FILTERS);
  });

  it('fetches the definition with the same id and version the key was built from, across the module boundary', async () => {
    const options = workflowQueries.detail('kyc', 3);

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchWorkflowDefinition).toHaveBeenCalledWith('kyc', 3);
  });
});
