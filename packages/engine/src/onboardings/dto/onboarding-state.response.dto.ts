import type { WorkflowStatus } from '@tsh/ddl-schema';
import type { ConnectorRejectionReason } from '../../connectors/ports/connector-execution.port';
import type { StepDescription } from '../../workflows/domain/step';

export type OnboardingStateResponse = {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowStatus;
  currentStep: string | null;
  terminal: boolean;
  rejectionReason: ConnectorRejectionReason | null;
  step: StepDescription | null;
};
