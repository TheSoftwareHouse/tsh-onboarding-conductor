import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_WORKFLOWS_ENDPOINT,
  fetchWorkflowDefinition,
  WorkflowDefinitionFetchError,
  type WorkflowDefinition,
} from './workflow-definitions';

const { mockedGet } = vi.hoisted(() => ({ mockedGet: vi.fn() }));

vi.mock('@/services/api/http-client', () => ({
  httpClient: { get: mockedGet },
}));

const VALID_DEFINITION: WorkflowDefinition = {
  workflowId: 'kyc',
  workflowVersion: 3,
  initialStep: 'collect_documents',
  scores: { risk: { min: 0, max: 100 } },
  steps: [
    {
      name: 'collect_documents',
      status: 'collect_documents',
      terminal: false,
      transitions: [{ status: 'success', target: 'review' }],
    },
  ],
};

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWorkflowDefinition', () => {
  it('requests the workflow at a path- and query-encoded id and version', async () => {
    mockedGet.mockResolvedValueOnce({ data: VALID_DEFINITION });

    await fetchWorkflowDefinition('kyc basic', 3);

    expect(mockedGet).toHaveBeenCalledWith(`${ADMIN_WORKFLOWS_ENDPOINT}/kyc%20basic`, {
      params: { version: 3 },
    });
  });

  it('returns the parsed definition for a valid payload', async () => {
    mockedGet.mockResolvedValueOnce({ data: VALID_DEFINITION });

    await expect(fetchWorkflowDefinition('kyc', 3)).resolves.toEqual(VALID_DEFINITION);
  });

  it('defaults scores to an empty map when the field is absent', async () => {
    const withoutScores: Record<string, unknown> = { ...VALID_DEFINITION };
    delete withoutScores.scores;
    mockedGet.mockResolvedValueOnce({ data: withoutScores });

    await expect(fetchWorkflowDefinition('kyc', 3)).resolves.toMatchObject({ scores: {} });
  });

  it('raises invalid-payload for a malformed definition', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ...VALID_DEFINITION, steps: undefined } });

    await expect(fetchWorkflowDefinition('kyc', 3)).rejects.toMatchObject({
      reason: 'invalid-payload' satisfies WorkflowDefinitionFetchError['reason'],
      message: 'Response contains a malformed workflow definition.',
    });
  });

  it('raises request-failed with the status and message for a refused request', async () => {
    const axiosError = new AxiosError('Request failed with status code 403');
    axiosError.response = { status: 403 } as AxiosError['response'];
    mockedGet.mockRejectedValueOnce(axiosError);

    await expect(fetchWorkflowDefinition('kyc', 3)).rejects.toMatchObject({
      reason: 'request-failed',
      status: 403,
      message: 'Your account is signed in but is not assigned a role that may view workflows.',
    });
  });

  it('surfaces the underlying message when the request never reached the engine', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network Error'));

    await expect(fetchWorkflowDefinition('kyc', 3)).rejects.toMatchObject({
      reason: 'request-failed',
      message: 'Network Error',
    });
  });
});
