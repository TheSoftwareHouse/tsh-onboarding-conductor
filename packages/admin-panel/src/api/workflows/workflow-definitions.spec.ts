import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_WORKFLOWS_ENDPOINT,
  fetchWorkflowDefinition,
  type WorkflowDefinition,
} from './workflow-definitions';

const { mockedGet } = vi.hoisted(() => ({ mockedGet: vi.fn() }));

vi.mock('@/services/api/http-client', () => ({
  httpClient: { get: mockedGet },
}));

const VALID_DEFINITION: WorkflowDefinition = {
  workflowId: 'kyc',
  workflowVersion: 3,
  name: null,
  initialStep: 'collect_documents',
  scores: { risk: { min: 0, max: 100 } },
  webhook: { notify: { path: '/notify' } },
  steps: [
    {
      name: 'collect_documents',
      status: 'collect_documents',
      terminal: false,
      transitions: [{ status: 'rejected', target: 'review', reason: ['CHALLENGE_EXPIRED'] }],
      source: { step: 'collect_documents', type: 'custom', category: 'collect' },
      fields: [
        {
          name: 'passport',
          type: 'file',
          required: true,
          persist: false,
          when: { field: 'documentType', equals: 'PASSPORT' },
          schema: { type: 'string' },
          upload: { contentTypes: ['image/png'], maxSizeBytes: 1024, maxImageWidth: 800 },
        },
      ],
      connectors: [
        {
          id: 'kyc',
          name: 'KYC',
          type: 'kyc',
          order: 1,
          canReject: true,
          async: false,
          fieldMapping: { document: 'passport' },
          optionalFieldMapping: {},
          fallbacks: [
            {
              id: 'kyc-2',
              name: 'KYC 2',
              type: 'kyc',
              order: 2,
              canReject: false,
              async: true,
              fieldMapping: {},
              optionalFieldMapping: { note: 'note' },
            },
          ],
        },
      ],
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
  it('requests the pinned version at the encoded versions path', async () => {
    mockedGet.mockResolvedValueOnce({ data: VALID_DEFINITION });

    await fetchWorkflowDefinition('kyc basic', 3);

    expect(mockedGet).toHaveBeenCalledWith(`${ADMIN_WORKFLOWS_ENDPOINT}/kyc%20basic/versions/3`);
  });

  it('requests the bare workflow path when unpinned', async () => {
    mockedGet.mockResolvedValueOnce({ data: VALID_DEFINITION });

    await fetchWorkflowDefinition('kyc');

    expect(mockedGet).toHaveBeenCalledWith(`${ADMIN_WORKFLOWS_ENDPOINT}/kyc`);
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

  it('parses a payload without any of the newer keys, keeping the onboarding-details contract', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        workflowId: 'kyc',
        workflowVersion: 3,
        initialStep: 'a',
        steps: [
          {
            name: 'a',
            status: 'awaiting_user',
            terminal: false,
            transitions: [{ status: 'success', target: null, when: null }],
          },
        ],
      },
    });

    await expect(fetchWorkflowDefinition('kyc', 3)).resolves.toEqual({
      workflowId: 'kyc',
      workflowVersion: 3,
      name: null,
      initialStep: 'a',
      scores: {},
      webhook: null,
      steps: [
        {
          name: 'a',
          status: 'awaiting_user',
          terminal: false,
          transitions: [{ status: 'success', target: null, when: null, reason: null }],
          source: null,
          fields: [],
          connectors: [],
        },
      ],
    });
  });

  it('raises invalid-payload for a malformed definition', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ...VALID_DEFINITION, steps: undefined } });

    await expect(fetchWorkflowDefinition('kyc', 3)).rejects.toMatchObject({
      kind: 'invalid-payload',
      message: 'Response contains a malformed workflow definition.',
    });
  });

  it('raises request-failed with the status and message for a refused request', async () => {
    const axiosError = new AxiosError('Request failed with status code 403');
    axiosError.response = { status: 403 } as AxiosError['response'];
    mockedGet.mockRejectedValueOnce(axiosError);

    await expect(fetchWorkflowDefinition('kyc', 3)).rejects.toMatchObject({
      kind: 'request-failed',
      status: 403,
      message: 'Your account is signed in but is not assigned a role that may view workflows.',
    });
  });

  it('surfaces the underlying message when the request never reached the engine', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network Error'));

    await expect(fetchWorkflowDefinition('kyc', 3)).rejects.toMatchObject({
      kind: 'request-failed',
      message: 'Network Error',
    });
  });
});
