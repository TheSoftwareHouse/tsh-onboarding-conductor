import { AxiosError, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteWorkflowConnectorSelection,
  putWorkflowConnectorSelection,
  WorkflowConnectorSelectionWriteError,
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

beforeEach(() => {
  mockedPut.mockReset();
  mockedDelete.mockReset();
});

describe('putWorkflowConnectorSelection', () => {
  it('puts the connector id at an encoded path and returns the parsed slot', async () => {
    mockedPut.mockResolvedValueOnce({ data: SLOT });

    await expect(
      putWorkflowConnectorSelection('kyc basic', 'verify/id', 'veriff_kyc'),
    ).resolves.toEqual(SLOT);

    expect(mockedPut).toHaveBeenCalledWith(
      '/v1/admin/workflows/kyc%20basic/steps/verify%2Fid/connector',
      { connectorId: 'veriff_kyc' },
    );
  });

  it('rejects a malformed slot', async () => {
    mockedPut.mockResolvedValueOnce({ data: { id: 1 } });

    await expect(putWorkflowConnectorSelection('kyc', 'verify', 'x')).rejects.toThrow(
      'Response contains a malformed connector.',
    );
  });

  it('carries the reason and detail of a refused selection', async () => {
    mockedPut.mockRejectedValueOnce(
      httpError(400, {
        code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
        message: 'Selection refused.',
        reason: 'type_mismatch',
        detail: 'expected kyc',
        stepName: 'verify',
      }),
    );

    const error = await putWorkflowConnectorSelection('kyc', 'verify', 'smtp').catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(WorkflowConnectorSelectionWriteError);
    expect(error).toMatchObject({
      message: 'Selection refused.',
      status: 400,
      reason: 'type_mismatch',
      detail: 'expected kyc',
    });
  });

  it('describes any other failure by its status', async () => {
    mockedPut.mockRejectedValueOnce(httpError(404, { code: 'WORKFLOW_NOT_FOUND' }));

    const error = await putWorkflowConnectorSelection('kyc', 'verify', 'x').catch(
      (cause: unknown) => cause,
    );

    expect(error).toMatchObject({ status: 404, message: 'Request failed with status 404.' });
    expect((error as WorkflowConnectorSelectionWriteError).reason).toBeUndefined();
  });
});

describe('deleteWorkflowConnectorSelection', () => {
  it('deletes at the same encoded path', async () => {
    mockedDelete.mockResolvedValueOnce({ status: 204 });

    await deleteWorkflowConnectorSelection('kyc basic', 'verify');

    expect(mockedDelete).toHaveBeenCalledWith(
      '/v1/admin/workflows/kyc%20basic/steps/verify/connector',
    );
  });

  it('wraps a failure', async () => {
    mockedDelete.mockRejectedValueOnce(httpError(403, undefined));

    await expect(deleteWorkflowConnectorSelection('kyc', 'verify')).rejects.toMatchObject({
      status: 403,
    });
  });
});
