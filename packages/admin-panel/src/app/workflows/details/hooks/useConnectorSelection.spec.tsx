import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteWorkflowConnectorSelection,
  putWorkflowConnectorSelection,
} from '@/api/workflows/workflow-connector-selection';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { ApiError } from '@/services/api/api-error';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { useConnectorSelection } from './useConnectorSelection';

vi.mock('@/api/workflows/workflow-connector-selection', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/api/workflows/workflow-connector-selection')>();

  return {
    ...actual,
    putWorkflowConnectorSelection: vi.fn(),
    deleteWorkflowConnectorSelection: vi.fn(),
  };
});

const mockedPut = vi.mocked(putWorkflowConnectorSelection);
const mockedDelete = vi.mocked(deleteWorkflowConnectorSelection);

/** The app's own client, so the factories' meta invalidations run as they do in the panel. */
function setup() {
  const client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return { invalidate, ...renderHook(() => useConnectorSelection('kyc'), { wrapper }) };
}

beforeEach(() => {
  mockedPut.mockReset();
  mockedDelete.mockReset();
});

describe('useConnectorSelection', () => {
  it('selects a connector, invalidates the workflow’s reads and reports ok', async () => {
    mockedPut.mockResolvedValueOnce({} as never);
    const { result, invalidate } = setup();

    let outcome;
    await act(async () => {
      outcome = await result.current.select('verify', 'veriff_kyc');
    });

    expect(outcome).toEqual({ ok: true });
    expect(mockedPut).toHaveBeenCalledWith('kyc', 'verify', 'veriff_kyc');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: workflowQueries.detailsFor('kyc') });
  });

  it('returns the engine’s error without invalidating when a selection fails', async () => {
    const error = new ApiError('nope', {
      status: 400,
      code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
    });
    mockedPut.mockRejectedValueOnce(error);
    const { result, invalidate } = setup();

    let outcome;
    await act(async () => {
      outcome = await result.current.select('verify', 'smtp');
    });

    expect(outcome).toEqual({ ok: false, error });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('clears a selection and invalidates', async () => {
    mockedDelete.mockResolvedValueOnce(undefined);
    const { result, invalidate } = setup();

    let outcome;
    await act(async () => {
      outcome = await result.current.clear('verify');
    });

    expect(outcome).toEqual({ ok: true });
    expect(mockedDelete).toHaveBeenCalledWith('kyc', 'verify');
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('wraps a non-write error as a generic failure', async () => {
    mockedDelete.mockRejectedValueOnce(new TypeError('boom'));
    const { result } = setup();

    let outcome;
    await act(async () => {
      outcome = await result.current.clear('verify');
    });

    expect(outcome).toMatchObject({ ok: false, error: { message: 'Request failed.' } });
  });
});
