import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowStepDefinition } from '@/api/workflows/workflow-definitions';
import { WORKFLOW_VERSION_STATUS } from '@/api/workflows/workflow-versions';
import { StepInspector } from './StepInspector';

function step(overrides: Partial<WorkflowStepDefinition> = {}): WorkflowStepDefinition {
  return {
    name: 'verify_phone_send',
    status: 'PHONE_VERIFICATION',
    terminal: false,
    transitions: [],
    source: null,
    fields: [],
    connectors: [],
    ...overrides,
  };
}

function renderInspector(value: WorkflowStepDefinition): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <StepInspector
          workflowId="kyc"
          version={1}
          step={value}
          versionStatus={WORKFLOW_VERSION_STATUS.published}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('StepInspector', () => {
  it('names the authored step and type of a compiled step, with no friendly label', () => {
    renderInspector(
      step({ source: { step: 'verify_phone', type: 'otp-verify', category: 'verification' } }),
    );

    expect(screen.getByText('From verify_phone · otp-verify')).toBeInTheDocument();
    expect(screen.queryByText('Code verification')).not.toBeInTheDocument();
  });

  it('shows no source line when the step has none', () => {
    renderInspector(step());

    expect(screen.queryByText(/^From /)).not.toBeInTheDocument();
  });
});
