import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compileWorkflowDocument,
  createWorkflowDraft,
  deleteWorkflowDraft,
  fetchWorkflowDocument,
  publishWorkflowDraft,
  updateWorkflowDraft,
  readDraftError,
  type WorkflowDraftErrorCode,
} from './workflow-drafts';
import { ApiError } from '@/services/api/api-error';

const { mockedGet, mockedPost, mockedPut, mockedDelete } = vi.hoisted(() => ({
  mockedGet: vi.fn(),
  mockedPost: vi.fn(),
  mockedPut: vi.fn(),
  mockedDelete: vi.fn(),
}));

vi.mock('@/services/api/http-client', () => ({
  httpClient: {
    get: mockedGet,
    post: mockedPost,
    put: mockedPut,
    delete: mockedDelete,
  },
}));

const DRAFT = {
  workflowId: 'kyc',
  version: 2,
  status: 'draft',
  name: null,
  createdAt: '2026-10-06T09:00:00.000Z',
  updatedAt: '2026-10-06T09:00:00.000Z',
};
const DOCUMENT = { id: 'kyc', version: 2, steps: [] };
const WORKFLOW = {
  workflowId: 'kyc',
  workflowVersion: 2,
  initialStep: 'start',
  steps: [{ name: 'start', status: 'start', terminal: true, transitions: [] }],
};

function axiosFailure(status: number, data?: unknown): AxiosError {
  const axiosError = new AxiosError(`Request failed with status code ${status}`);
  axiosError.response = { status, data } as AxiosError['response'];
  return axiosError;
}

async function catchError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedPut.mockReset();
  mockedDelete.mockReset();
});

describe('workflow draft requests', () => {
  it('posts the document to create a draft and returns the summary', async () => {
    mockedPost.mockResolvedValueOnce({ data: DRAFT });

    await expect(createWorkflowDraft(DOCUMENT)).resolves.toEqual(DRAFT);
    expect(mockedPost).toHaveBeenCalledWith('/v1/admin/workflows', DOCUMENT);
  });

  it('reads the stored document at the encoded versions path', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ...DRAFT, document: DOCUMENT } });

    const result = await fetchWorkflowDocument('kyc basic', 2);

    expect(mockedGet).toHaveBeenCalledWith('/v1/admin/workflows/kyc%20basic/versions/2/document');
    expect(result.document).toEqual(DOCUMENT);
  });

  it('puts the document to update a draft', async () => {
    mockedPut.mockResolvedValueOnce({ data: DRAFT });

    await expect(updateWorkflowDraft('kyc', 2, DOCUMENT)).resolves.toEqual(DRAFT);
    expect(mockedPut).toHaveBeenCalledWith('/v1/admin/workflows/kyc/versions/2', DOCUMENT);
  });

  it('deletes a draft', async () => {
    mockedDelete.mockResolvedValueOnce({ data: '' });

    await expect(deleteWorkflowDraft('kyc', 2)).resolves.toBeUndefined();
    expect(mockedDelete).toHaveBeenCalledWith('/v1/admin/workflows/kyc/versions/2');
  });

  it('posts to the encoded publish path with no body and returns the publication', async () => {
    const published = { ...DRAFT, status: 'published' };
    mockedPost.mockResolvedValueOnce({ data: published });

    await expect(publishWorkflowDraft('kyc basic', 2)).resolves.toEqual(published);
    expect(mockedPost).toHaveBeenCalledWith('/v1/admin/workflows/kyc%20basic/versions/2/publish');
  });

  it('rejects a publication whose status is still draft as malformed', async () => {
    mockedPost.mockResolvedValueOnce({ data: DRAFT });

    const error = await catchError(publishWorkflowDraft('kyc', 2));

    expect(error.message).toBe('Response contains a malformed workflow draft.');
  });

  it.each(['published', 'retired'])('reads a %s version document', async (status) => {
    mockedGet.mockResolvedValueOnce({ data: { ...DRAFT, status, document: DOCUMENT } });

    await expect(fetchWorkflowDocument('kyc', 2)).resolves.toMatchObject({ status });
  });

  it('compiles a document and returns its step count and parsed workflow', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { definition: {}, steps: [{}, {}], workflow: WORKFLOW },
    });

    const result = await compileWorkflowDocument(DOCUMENT);

    expect(result.stepCount).toBe(2);
    expect(result.workflow).toMatchObject({ workflowId: 'kyc', initialStep: 'start' });
    expect(mockedPost).toHaveBeenCalledWith('/v1/admin/workflows/compile', DOCUMENT);
  });
});

describe('draft ApiError', () => {
  const CONFLICT_CODES: WorkflowDraftErrorCode[] = [
    'WORKFLOW_VERSION_EXISTS',
    'WORKFLOW_DRAFT_EXISTS',
    'WORKFLOW_SCOPE_CONFLICT',
    'WORKFLOW_DRAFT_IN_USE',
    'WORKFLOW_VERSION_NOT_DRAFT',
    'WORKFLOW_VERSION_NOT_LATEST',
  ];

  it.each(CONFLICT_CODES)('parses the 409 code %s', async (code) => {
    const body = { code, message: code, workflowId: 'kyc', version: 2, status: 'published' };
    mockedPut.mockRejectedValueOnce(axiosFailure(409, body));

    const error = await catchError(updateWorkflowDraft('kyc', 2, DOCUMENT));

    expect(error.code).toBe(code);
    expect(readDraftError(error)?.code).toBe(code);
    expect(error.message).toBe(code);
    expect(error.status).toBe(409);
    expect(error.body).toMatchObject({ status: 'published' });
  });

  it('reads NOT_LATEST from a publish refusal', async () => {
    mockedPost.mockRejectedValueOnce(
      axiosFailure(409, {
        code: 'WORKFLOW_VERSION_NOT_LATEST',
        message: 'WORKFLOW_VERSION_NOT_LATEST',
        workflowId: 'kyc',
        version: 2,
        latestPublishedVersion: 3,
      }),
    );

    const error = await catchError(publishWorkflowDraft('kyc', 2));

    expect(readDraftError(error)?.code).toBe('WORKFLOW_VERSION_NOT_LATEST');
  });

  it('keeps the reason and path of a 400 WORKFLOW_INVALID', async () => {
    mockedPost.mockRejectedValueOnce(
      axiosFailure(400, {
        code: 'WORKFLOW_INVALID',
        reason: 'INVALID_SHAPE',
        path: 'id',
        message: 'WORKFLOW_INVALID',
      }),
    );

    const error = await catchError(createWorkflowDraft({}));

    expect(readDraftError(error)).toEqual({
      code: 'WORKFLOW_INVALID',
      reason: 'INVALID_SHAPE',
      path: 'id',
    });
    expect(error.status).toBe(400);
  });

  it('parses a 404 WORKFLOW_NOT_FOUND', async () => {
    mockedGet.mockRejectedValueOnce(axiosFailure(404, { code: 'WORKFLOW_NOT_FOUND' }));

    expect(readDraftError(await catchError(fetchWorkflowDocument('kyc', 2)))?.code).toBe(
      'WORKFLOW_NOT_FOUND',
    );
  });

  it('reads no draft error for a code it does not know', async () => {
    mockedDelete.mockRejectedValueOnce(axiosFailure(409, { code: 'SOMETHING_ELSE' }));

    const error = await catchError(deleteWorkflowDraft('kyc', 2));

    expect(readDraftError(error)).toBeNull();
    expect(error.status).toBe(409);
  });

  it('reads no draft error for a failure with no body', async () => {
    mockedGet.mockRejectedValueOnce(axiosFailure(500));

    const error = await catchError(fetchWorkflowDocument('kyc', 2));

    expect(readDraftError(error)).toBeNull();
    expect(error.status).toBe(500);
  });

  it('rejects an invalid payload', async () => {
    mockedPost.mockResolvedValueOnce({ data: { ...DRAFT, status: 'published' } });

    const error = await catchError(createWorkflowDraft(DOCUMENT));

    expect(error.kind).toBe('invalid-payload');
    expect(error.status).toBeUndefined();
  });

  it('rejects a compile payload with no step report', async () => {
    mockedPost.mockResolvedValueOnce({ data: { definition: {} } });

    await catchError(compileWorkflowDocument(DOCUMENT));
  });

  it('rejects a compile payload whose workflow is malformed', async () => {
    mockedPost.mockResolvedValueOnce({ data: { steps: [], workflow: {} } });

    const error = await catchError(compileWorkflowDocument(DOCUMENT));

    expect(error.kind).toBe('invalid-payload');
  });
});
