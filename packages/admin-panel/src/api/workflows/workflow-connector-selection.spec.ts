import { AxiosError, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import {
  deleteWorkflowConnectorSelection,
  putWorkflowConnectorSelection,
  readConnectorSelectionRefusal,
} from './workflow-connector-selection';

const { mockedPut, mockedDelete } = vi.hoisted(() => ({
  mockedPut: vi.fn(),
  mockedDelete: vi.fn(),
}));

vi.mock('@/services/api/http-client', () => ({
  httpClient: { put: mockedPut, delete: mockedDelete },
}));

const SLOT = {
  id: 'veriff_kyc',
  authoredId: 'sumsub_kyc',
  selected: true,
  selectableIds: ['sumsub_kyc', 'veriff_kyc'],
  versions: [{ version: 2, id: 'veriff_kyc', authoredId: 'sumsub_kyc', selected: true }],
  name: 'KYC',
  type: 'kyc',
  order: 1,
  canReject: true,
  async: true,
  fieldMapping: {},
  optionalFieldMapping: {},
  fallbacks: [],
};

function httpError(status: number, data: unknown): AxiosError {
  return new AxiosError('failed', undefined, undefined, undefined, {
    status,
    data,
  } as AxiosResponse);
}

const ALL = { scope: 'all' } as const;

beforeEach(() => {
  mockedPut.mockReset();
  mockedDelete.mockReset();
});

describe('putWorkflowConnectorSelection', () => {
  it('puts the connector id at an encoded path and returns the parsed slot', async () => {
    mockedPut.mockResolvedValueOnce({ data: SLOT });

    await expect(
      putWorkflowConnectorSelection('kyc basic', 'verify/id', 'veriff_kyc', {
        scope: 'version',
        version: 2,
      }),
    ).resolves.toEqual(SLOT);

    expect(mockedPut).toHaveBeenCalledWith(
      '/v1/admin/workflows/kyc%20basic/steps/verify%2Fid/connector',
      { connectorId: 'veriff_kyc', scope: 'version', version: 2 },
    );
  });

  it('puts the all scope without a version', async () => {
    mockedPut.mockResolvedValueOnce({ data: SLOT });

    await putWorkflowConnectorSelection('kyc', 'verify', 'veriff_kyc', { scope: 'all' });

    expect(mockedPut).toHaveBeenCalledWith('/v1/admin/workflows/kyc/steps/verify/connector', {
      connectorId: 'veriff_kyc',
      scope: 'all',
    });
  });

  it('rejects a malformed slot', async () => {
    mockedPut.mockResolvedValueOnce({ data: { id: 1 } });

    await expect(putWorkflowConnectorSelection('kyc', 'verify', 'x', ALL)).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-payload',
      message: 'Response contains a malformed connector.',
    });
  });

  it('carries the refusal of a refused selection: the version, the reason and the detail', async () => {
    mockedPut.mockRejectedValueOnce(
      httpError(400, {
        code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
        message: 'Selection refused.',
        stepName: 'verify',
        connectorId: 'smtp',
        workflowVersion: 3,
        reason: 'type_mismatch',
        detail: 'expected kyc',
      }),
    );

    const error = await putWorkflowConnectorSelection('kyc', 'verify', 'smtp', ALL).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID' });
    expect(readConnectorSelectionRefusal(error as ApiError)).toEqual({
      message: 'Selection refused.',
      stepName: 'verify',
      connectorId: 'smtp',
      workflowVersion: 3,
      reason: 'type_mismatch',
      detail: 'expected kyc',
    });
  });

  it('reads no refusal when the body does not name the version', async () => {
    mockedPut.mockRejectedValueOnce(
      httpError(400, {
        code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
        message: 'Selection refused.',
        reason: 'type_mismatch',
      }),
    );

    const error = await putWorkflowConnectorSelection('kyc', 'verify', 'smtp', ALL).catch(
      (cause: unknown) => cause,
    );

    expect(error).toMatchObject({ status: 400, message: 'Request failed with status 400.' });
    expect(readConnectorSelectionRefusal(error as ApiError)).toBeNull();
  });

  it('describes any other failure by its status', async () => {
    mockedPut.mockRejectedValueOnce(httpError(404, { code: 'WORKFLOW_NOT_FOUND' }));

    const error = await putWorkflowConnectorSelection('kyc', 'verify', 'x', ALL).catch(
      (cause: unknown) => cause,
    );

    expect(error).toMatchObject({ status: 404, message: 'Request failed with status 404.' });
    expect(readConnectorSelectionRefusal(error as ApiError)).toBeNull();
  });
});

describe('deleteWorkflowConnectorSelection', () => {
  it('deletes at the same encoded path', async () => {
    mockedDelete.mockResolvedValueOnce({ status: 204 });

    await deleteWorkflowConnectorSelection('kyc basic', 'verify', {
      scope: 'version',
      version: 2,
    });

    expect(mockedDelete).toHaveBeenCalledWith(
      '/v1/admin/workflows/kyc%20basic/steps/verify/connector',
      { params: { scope: 'version', version: 2 } },
    );
  });

  it('deletes the all scope without a version', async () => {
    mockedDelete.mockResolvedValueOnce({ status: 204 });

    await deleteWorkflowConnectorSelection('kyc', 'verify', ALL);

    expect(mockedDelete).toHaveBeenCalledWith('/v1/admin/workflows/kyc/steps/verify/connector', {
      params: { scope: 'all' },
    });
  });

  it('wraps a failure', async () => {
    mockedDelete.mockRejectedValueOnce(httpError(403, undefined));

    await expect(deleteWorkflowConnectorSelection('kyc', 'verify', ALL)).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
    });
  });
});
