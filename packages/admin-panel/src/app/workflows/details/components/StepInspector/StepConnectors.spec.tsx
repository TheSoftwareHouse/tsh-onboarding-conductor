import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteWorkflowConnectorSelection,
  putWorkflowConnectorSelection,
} from '@/api/workflows/workflow-connector-selection';
import { ApiError } from '@/services/api/api-error';
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
    versions: [
      { version: 1, id: 'sumsub_kyc', authoredId: 'sumsub_kyc', selected: false },
      { version: 2, id: 'sumsub_kyc', authoredId: 'sumsub_kyc', selected: false },
    ],
    ...overrides,
  };
}

function renderConnectors(
  connectors: WorkflowStepConnectorWithFallbacks[],
  readOnly = false,
): ReactElement {
  const view = (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <StepConnectors
          workflowId="kyc"
          stepName="verify"
          version={2}
          connectors={connectors}
          readOnly={readOnly}
        />
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
    expect(screen.queryByRole('button', { name: /Save for/ })).not.toBeInTheDocument();
  });

  it('offers no choice on a draft or a retired version', () => {
    renderConnectors([connector({ selected: true })], true);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save for|Restore/ })).not.toBeInTheDocument();
    expect(screen.getByText('sumsub_kyc')).toBeInTheDocument();
  });

  it('lists the selectable adapters, marks the authored one and shows the helper text', () => {
    renderConnectors([connector({ id: 'veriff_kyc', selected: true })]);

    const select = screen.getByRole('combobox', { name: 'Connector for verify' });
    expect(select).toHaveValue('veriff_kyc');
    expect(screen.getByRole('option', { name: 'sumsub_kyc (authored)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'veriff_kyc' })).toBeInTheDocument();
    expect(
      screen.getByText(/Saves for this version, or for every published version with this step/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '→ Global settings for veriff_kyc' }),
    ).toBeInTheDocument();
  });

  it('saves nothing when the select changes, and enables Save only for another id', async () => {
    renderConnectors([connector()]);
    const save = screen.getByRole('button', { name: 'Save for v2' });
    expect(save).toBeDisabled();

    await userEvent.selectOptions(screen.getByRole('combobox'), 'veriff_kyc');

    expect(mockedPut).not.toHaveBeenCalled();
    expect(save).toBeEnabled();
  });

  it('drops an unsaved choice when another step sharing the connector opens', async () => {
    const user = userEvent.setup();
    const renderStep = (stepName: string): ReactElement => (
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <StepConnectors
            workflowId="kyc"
            stepName={stepName}
            version={2}
            connectors={[connector()]}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(renderStep('send_code'));

    await user.selectOptions(screen.getByRole('combobox'), 'veriff_kyc');
    rerender(renderStep('verify_code'));

    expect(screen.getByRole('combobox', { name: 'Connector for verify_code' })).toHaveValue(
      'sumsub_kyc',
    );
    expect(screen.getByRole('button', { name: 'Save for v2' })).toBeDisabled();
  });

  it('saves for this version and confirms with a toast', async () => {
    mockedPut.mockResolvedValueOnce(connector({ id: 'veriff_kyc' }));
    renderConnectors([connector()]);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'veriff_kyc');
    await userEvent.click(screen.getByRole('button', { name: 'Save for v2' }));

    expect(mockedPut).toHaveBeenCalledWith('kyc', 'verify', 'veriff_kyc', {
      scope: 'version',
      version: 2,
    });
    await waitFor(() =>
      expect(showSuccessToast).toHaveBeenCalledWith('Connector set to veriff_kyc on v2'),
    );
  });

  it('applies to all covered versions', async () => {
    mockedPut.mockResolvedValueOnce(connector({ id: 'veriff_kyc' }));
    renderConnectors([connector()]);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'veriff_kyc');
    await userEvent.click(screen.getByRole('button', { name: 'Apply to all published versions' }));

    expect(mockedPut).toHaveBeenCalledWith('kyc', 'verify', 'veriff_kyc', { scope: 'all' });
    await waitFor(() =>
      expect(showSuccessToast).toHaveBeenCalledWith('Connector set to veriff_kyc on v1, v2'),
    );
  });

  it('hides Apply and Restore on all versions when one version is covered', () => {
    renderConnectors([
      connector({
        selected: true,
        versions: [{ version: 2, id: 'sumsub_kyc', authoredId: 'sumsub_kyc', selected: true }],
      }),
    ]);

    expect(screen.queryByRole('button', { name: /Apply to all/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Restore on all versions' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore on v2' })).toBeInTheDocument();
  });

  it('restores on this version and on all versions', async () => {
    mockedDelete.mockResolvedValue(undefined);
    renderConnectors([
      connector({
        id: 'veriff_kyc',
        selected: true,
        versions: [
          { version: 1, id: 'veriff_kyc', authoredId: 'sumsub_kyc', selected: true },
          { version: 2, id: 'veriff_kyc', authoredId: 'sumsub_kyc', selected: true },
        ],
      }),
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Restore on v2' }));
    expect(mockedDelete).toHaveBeenCalledWith('kyc', 'verify', { scope: 'version', version: 2 });
    await waitFor(() =>
      expect(showSuccessToast).toHaveBeenCalledWith('Authored connector restored on v2'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Restore on all versions' }));
    expect(mockedDelete).toHaveBeenCalledWith('kyc', 'verify', { scope: 'all' });
    await waitFor(() =>
      expect(showSuccessToast).toHaveBeenCalledWith('Authored connector restored on every version'),
    );
  });

  it('explains a refused selection in an error toast', async () => {
    mockedPut.mockRejectedValueOnce(
      new ApiError('refused', {
        status: 400,
        code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
        body: {
          code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
          message: 'refused',
          stepName: 'verify',
          connectorId: 'veriff_kyc',
          workflowVersion: 1,
          reason: 'async_unsupported',
        },
      }),
    );
    renderConnectors([connector()]);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'veriff_kyc');
    await userEvent.click(screen.getByRole('button', { name: 'Save for v2' }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(
        'Unable to change connector',
        'Version 1 refused: This connector cannot answer by callback, and this step waits for one.',
      ),
    );
  });

  it('raises an error toast when restoring fails', async () => {
    mockedDelete.mockRejectedValueOnce(new ApiError('gone', { status: 404 }));
    renderConnectors([connector({ id: 'veriff_kyc', selected: true })]);

    await userEvent.click(screen.getByRole('button', { name: 'Restore on v2' }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith('Unable to change connector', 'gone'),
    );
  });
});
