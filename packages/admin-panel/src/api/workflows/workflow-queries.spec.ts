import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { workflowQueries } from './workflow-queries';
import {
  fetchAdminWorkflows,
  type AdminWorkflowQueryFilters,
  type AdminWorkflowsPage,
} from './admin-workflows';
import { fetchWorkflowDefinition, type WorkflowDefinition } from './workflow-definitions';
import { fetchWorkflowDocument, type WorkflowVersionDocument } from './workflow-drafts';
import { fetchWorkflowVersions, type WorkflowVersion } from './workflow-versions';

vi.mock('./admin-workflows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-workflows')>()),
  fetchAdminWorkflows: vi.fn(),
}));

vi.mock('./workflow-definitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflow-definitions')>()),
  fetchWorkflowDefinition: vi.fn(),
}));

vi.mock('./workflow-drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflow-drafts')>()),
  fetchWorkflowDocument: vi.fn(),
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

function isInvalidated(client: QueryClient, queryKey: QueryKey): boolean | undefined {
  return client.getQueryState(queryKey)?.isInvalidated;
}

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
    expect(workflowQueries.document('kyc', 3).queryKey).toEqual([
      ...workflowQueries.detail('kyc', 3).queryKey,
      'document',
    ]);
  });

  it('fetches the document with the id and version it was built from', async () => {
    const options = workflowQueries.document('kyc', 3);

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(vi.mocked(fetchWorkflowDocument)).toHaveBeenCalledWith('kyc', 3);
  });

  it('lets one invalidation of a workflow reach every read of it, and no other workflow', async () => {
    const client = new QueryClient();
    client.setQueryData(workflowQueries.detail('kyc').queryKey, {} as WorkflowDefinition);
    client.setQueryData(workflowQueries.detail('kyc', 3).queryKey, {} as WorkflowDefinition);
    client.setQueryData(workflowQueries.document('kyc', 3).queryKey, {} as WorkflowVersionDocument);
    client.setQueryData(workflowQueries.versions('kyc').queryKey, [] as WorkflowVersion[]);
    client.setQueryData(workflowQueries.versions('other').queryKey, [] as WorkflowVersion[]);

    await client.invalidateQueries({ queryKey: workflowQueries.detailsFor('kyc') });

    expect(isInvalidated(client, workflowQueries.detail('kyc').queryKey)).toBe(true);
    expect(isInvalidated(client, workflowQueries.detail('kyc', 3).queryKey)).toBe(true);
    expect(isInvalidated(client, workflowQueries.document('kyc', 3).queryKey)).toBe(true);
    expect(isInvalidated(client, workflowQueries.versions('kyc').queryKey)).toBe(true);
    expect(isInvalidated(client, workflowQueries.versions('other').queryKey)).toBe(false);
  });

  it("lets one invalidation of a version's definition reach its document, and none of its family's other reads", async () => {
    const client = new QueryClient();
    client.setQueryData(workflowQueries.detail('kyc', 3).queryKey, {} as WorkflowDefinition);
    client.setQueryData(workflowQueries.document('kyc', 3).queryKey, {} as WorkflowVersionDocument);
    client.setQueryData(workflowQueries.detail('kyc', 2).queryKey, {} as WorkflowDefinition);
    client.setQueryData(workflowQueries.detail('kyc').queryKey, {} as WorkflowDefinition);
    client.setQueryData(workflowQueries.versions('kyc').queryKey, [] as WorkflowVersion[]);

    await client.invalidateQueries({ queryKey: workflowQueries.detail('kyc', 3).queryKey });

    expect(isInvalidated(client, workflowQueries.detail('kyc', 3).queryKey)).toBe(true);
    expect(isInvalidated(client, workflowQueries.document('kyc', 3).queryKey)).toBe(true);
    expect(isInvalidated(client, workflowQueries.detail('kyc', 2).queryKey)).toBe(false);
    expect(isInvalidated(client, workflowQueries.detail('kyc').queryKey)).toBe(false);
    expect(isInvalidated(client, workflowQueries.versions('kyc').queryKey)).toBe(false);
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
