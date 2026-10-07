import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compileWorkflowDocument,
  createWorkflowDraft,
  deleteWorkflowDraft,
  fetchWorkflowDocument,
  updateWorkflowDraft,
  WorkflowDraftError,
  type WorkflowDraftErrorCode,
} from './workflow-drafts';

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

function axiosFailure(status: number, data?: unknown): AxiosError {
  const axiosError = new AxiosError(`Request failed with status code ${status}`);
  axiosError.response = { status, data } as AxiosError['response'];
  return axiosError;
}

async function catchError(promise: Promise<unknown>): Promise<WorkflowDraftError> {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(WorkflowDraftError);
  return error as WorkflowDraftError;
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

  it('compiles a document and reports its authored step count', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { definition: {}, steps: [{}, {}], workflow: {} },
    });

    await expect(compileWorkflowDocument(DOCUMENT)).resolves.toEqual({ stepCount: 2 });
    expect(mockedPost).toHaveBeenCalledWith('/v1/admin/workflows/compile', DOCUMENT);
  });
});

describe('WorkflowDraftError', () => {
  const CONFLICT_CODES: WorkflowDraftErrorCode[] = [
    'WORKFLOW_VERSION_EXISTS',
    'WORKFLOW_DRAFT_EXISTS',
    'WORKFLOW_SCOPE_CONFLICT',
    'WORKFLOW_DRAFT_IN_USE',
    'WORKFLOW_VERSION_NOT_DRAFT',
  ];

  it.each(CONFLICT_CODES)('parses the 409 code %s', async (code) => {
    mockedPut.mockRejectedValueOnce(axiosFailure(409, { code, message: code }));

    const error = await catchError(updateWorkflowDraft('kyc', 2, DOCUMENT));

    expect(error.code).toBe(code);
    expect(error.status).toBe(409);
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

    expect(error.code).toBe('WORKFLOW_INVALID');
    expect(error.reason).toBe('INVALID_SHAPE');
    expect(error.path).toBe('id');
    expect(error.status).toBe(400);
  });

  it('parses a 404 WORKFLOW_NOT_FOUND', async () => {
    mockedGet.mockRejectedValueOnce(axiosFailure(404, { code: 'WORKFLOW_NOT_FOUND' }));

    expect((await catchError(fetchWorkflowDocument('kyc', 2))).code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('leaves the code null for a code it does not know', async () => {
    mockedDelete.mockRejectedValueOnce(axiosFailure(409, { code: 'SOMETHING_ELSE' }));

    const error = await catchError(deleteWorkflowDraft('kyc', 2));

    expect(error.code).toBeNull();
    expect(error.status).toBe(409);
  });

  it('leaves the code null for a failure with no body', async () => {
    mockedGet.mockRejectedValueOnce(axiosFailure(500));

    const error = await catchError(fetchWorkflowDocument('kyc', 2));

    expect(error.code).toBeNull();
    expect(error.status).toBe(500);
  });

  it('rejects an invalid payload', async () => {
    mockedPost.mockResolvedValueOnce({ data: { ...DRAFT, status: 'published' } });

    const error = await catchError(createWorkflowDraft(DOCUMENT));

    expect(error.code).toBeNull();
    expect(error.status).toBeUndefined();
  });

  it('rejects a compile payload with no step report', async () => {
    mockedPost.mockResolvedValueOnce({ data: { definition: {} } });

    await catchError(compileWorkflowDocument(DOCUMENT));
  });
});
