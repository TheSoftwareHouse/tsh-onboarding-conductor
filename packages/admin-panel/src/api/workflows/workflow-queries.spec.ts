import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { workflowQueries } from './workflow-queries';
import {
  fetchAdminWorkflows,
  type AdminWorkflowQueryFilters,
  type AdminWorkflowsPage,
} from './admin-workflows';
import { fetchWorkflowDefinition, type WorkflowDefinition } from './workflow-definitions';
import { fetchWorkflowVersions, type WorkflowVersion } from './workflow-versions';

vi.mock('./admin-workflows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-workflows')>()),
  fetchAdminWorkflows: vi.fn(),
}));

vi.mock('./workflow-definitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflow-definitions')>()),
  fetchWorkflowDefinition: vi.fn(),
}));

vi.mock('./workflow-versions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflow-versions')>()),
  fetchWorkflowVersions: vi.fn(),
}));

const mockedFetchWorkflowVersions = vi.mocked(fetchWorkflowVersions);
const mockedFetchAdminWorkflows = vi.mocked(fetchAdminWorkflows);
const mockedFetchWorkflowDefinition = vi.mocked(fetchWorkflowDefinition);

const DEFINITION: WorkflowDefinition = {
  workflowId: 'kyc',
  workflowVersion: 3,
  name: null,
  initialStep: 'collect_documents',
  scores: {},
  webhook: null,
  steps: [],
};

const VERSIONS: WorkflowVersion[] = [
  { version: 1, status: 'published', createdAt: '2026-07-01', updatedAt: '2026-07-02' },
];

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
  mockedFetchWorkflowVersions.mockReset();
  mockedFetchWorkflowVersions.mockResolvedValue(VERSIONS);
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
    expect(workflowQueries.detailsFor('kyc')).toEqual(['workflows', 'details', 'kyc']);
    expect(workflowQueries.detail('kyc', 3).queryKey).toEqual(['workflows', 'details', 'kyc', 3]);
    expect(workflowQueries.detail('kyc').queryKey).toEqual([
      'workflows',
      'details',
      'kyc',
      undefined,
    ]);
    expect(workflowQueries.versions('kyc').queryKey).toEqual([
      'workflows',
      'details',
      'kyc',
      'versions',
    ]);
  });

  it('lets one invalidation of a workflow reach its definitions and its versions list', async () => {
    const client = new QueryClient();
    client.setQueryData(workflowQueries.detail('kyc', 3).queryKey, {} as WorkflowDefinition);
    client.setQueryData(workflowQueries.versions('kyc').queryKey, [] as WorkflowVersion[]);
    client.setQueryData(workflowQueries.versions('other').queryKey, [] as WorkflowVersion[]);

    await client.invalidateQueries({ queryKey: workflowQueries.detailsFor('kyc') });

    expect(client.getQueryState(workflowQueries.detail('kyc', 3).queryKey)?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(workflowQueries.versions('kyc').queryKey)?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(workflowQueries.versions('other').queryKey)?.isInvalidated).toBe(
      false,
    );
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

  it('fetches an unpinned definition when the key was built without a version', async () => {
    const options = workflowQueries.detail('kyc');

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchWorkflowDefinition).toHaveBeenCalledWith('kyc', undefined);
  });

  it('fetches the versions for the same id the key was built from, across the module boundary', async () => {
    const options = workflowQueries.versions('kyc');

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchWorkflowVersions).toHaveBeenCalledWith('kyc');
  });
});
