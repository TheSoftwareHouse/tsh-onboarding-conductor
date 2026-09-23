import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workflowQueries } from './workflow-queries';
import { fetchWorkflowDefinition, type WorkflowDefinition } from './workflow-definitions';

vi.mock('./workflow-definitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflow-definitions')>()),
  fetchWorkflowDefinition: vi.fn(),
}));

const mockedFetchWorkflowDefinition = vi.mocked(fetchWorkflowDefinition);

const DEFINITION: WorkflowDefinition = {
  workflowId: 'kyc',
  workflowVersion: 3,
  name: 'KYC',
  initialStep: 'collect_documents',
  scores: {},
  steps: [],
};

beforeEach(() => {
  mockedFetchWorkflowDefinition.mockReset();
  mockedFetchWorkflowDefinition.mockResolvedValue(DEFINITION);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workflowQueries', () => {
  it('builds the key hierarchy exactly as pinned', () => {
    expect(workflowQueries.all()).toEqual(['workflows']);
    expect(workflowQueries.details()).toEqual(['workflows', 'details']);
    expect(workflowQueries.detail('kyc', 3).queryKey).toEqual(['workflows', 'details', 'kyc', 3]);
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
