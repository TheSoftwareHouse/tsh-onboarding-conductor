import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkflowConnectorSelectionWriteError,
  deleteWorkflowConnectorSelection,
  putWorkflowConnectorSelection,
} from '@/api/workflows/workflow-connector-selection';
import type { WorkflowStepConnectorWithFallbacks } from '@/api/workflows/workflow-definitions';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { StepConnectors } from './StepConnectors';

vi.mock('@/api/workflows/workflow-connector-selection', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/api/workflows/workflow-connector-selection')>();

  return {
    ...actual,
    putWorkflowConnectorSelection: vi.fn(),
    deleteWorkflowConnectorSelection: vi.fn(),
  };
});

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

const mockedPut = vi.mocked(putWorkflowConnectorSelection);
const mockedDelete = vi.mocked(deleteWorkflowConnectorSelection);

function connector(
  overrides: Partial<WorkflowStepConnectorWithFallbacks> = {},
): WorkflowStepConnectorWithFallbacks {
  return {
    id: 'sumsub_kyc',
    authoredId: 'sumsub_kyc',
    selected: false,
    selectableIds: ['sumsub_kyc', 'veriff_kyc'],
    name: 'sumsub_kyc',
    type: 'kyc',
    order: 1,
    canReject: true,
    async: true,
    fieldMapping: {},
    optionalFieldMapping: {},
    fallbacks: [],
    ...overrides,
  };
}

function renderConnectors(connectors: WorkflowStepConnectorWithFallbacks[]): ReactElement {
  const view = (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <StepConnectors workflowId="kyc" stepName="verify" connectors={connectors} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(view);

  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('StepConnectors', () => {
  it('offers no choice when only one adapter can serve the slot', () => {
    renderConnectors([connector({ selectableIds: ['sumsub_kyc'] })]);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Use authored connector' }),
    ).not.toBeInTheDocument();
  });

  it('lists the selectable adapters, marks the authored one and shows the effective one', () => {
    renderConnectors([connector({ id: 'veriff_kyc', selected: true })]);

    const select = screen.getByRole('combobox', { name: 'Connector for verify' });
    expect(select).toHaveValue('veriff_kyc');
    expect(screen.getByRole('option', { name: 'sumsub_kyc (authored)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'veriff_kyc' })).toBeInTheDocument();
    expect(screen.getByText(/Applies to every version of this workflow/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '→ Global settings for veriff_kyc' }),
    ).toBeInTheDocument();
  });

  it('selects another connector and confirms with a toast', async () => {
    mockedPut.mockResolvedValueOnce(connector({ id: 'veriff_kyc' }));
    renderConnectors([connector()]);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'veriff_kyc');

    expect(mockedPut).toHaveBeenCalledWith('kyc', 'verify', 'veriff_kyc');
    await waitFor(() =>
      expect(showSuccessToast).toHaveBeenCalledWith('Connector set to veriff_kyc'),
    );
  });

  it('explains a refused selection in an error toast', async () => {
    mockedPut.mockRejectedValueOnce(
      new WorkflowConnectorSelectionWriteError('refused', 400, 'async_unsupported'),
    );
    renderConnectors([connector()]);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'veriff_kyc');

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(
        'Unable to change connector',
        expect.stringContaining('cannot answer by callback'),
      ),
    );
  });

  it('restores the authored connector only while a selection exists', async () => {
    mockedDelete.mockResolvedValueOnce(undefined);
    renderConnectors([connector({ id: 'veriff_kyc', selected: true })]);

    await userEvent.click(screen.getByRole('button', { name: 'Use authored connector' }));

    expect(mockedDelete).toHaveBeenCalledWith('kyc', 'verify');
    await waitFor(() =>
      expect(showSuccessToast).toHaveBeenCalledWith('Authored connector restored'),
    );
  });

  it('raises an error toast when restoring fails', async () => {
    mockedDelete.mockRejectedValueOnce(new WorkflowConnectorSelectionWriteError('gone', 404));
    renderConnectors([connector({ id: 'veriff_kyc', selected: true })]);

    await userEvent.click(screen.getByRole('button', { name: 'Use authored connector' }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith('Unable to change connector', 'gone'),
    );
  });
});
