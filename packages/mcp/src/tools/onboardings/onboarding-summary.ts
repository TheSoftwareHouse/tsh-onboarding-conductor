import type { components } from '@tsh/openapi';

type AdminOnboardingSummary = components['schemas']['AdminOnboardingSummaryResponseDto'];

/** The engine's summary row without the reserved `expiresAt`: system fields only, no applicant data. */
export type OnboardingSummary = Omit<AdminOnboardingSummary, 'expiresAt'>;

/** Names every field it keeps, so a field the engine adds later does not reach the model unreviewed. */
export function toOnboardingSummary(row: AdminOnboardingSummary): OnboardingSummary {
  const { pendingConnector } = row;

  return {
    onboardingId: row.onboardingId,
    workflowId: row.workflowId,
    workflowVersion: row.workflowVersion,
    status: row.status,
    currentStep: row.currentStep,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    rejectionReason: row.rejectionReason,
    scores: Object.fromEntries(
      Object.entries(row.scores ?? {}).filter(([, score]) => typeof score === 'number'),
    ),
    agreementStatus: row.agreementStatus,
    pendingConnector: pendingConnector && {
      connectorId: pendingConnector.connectorId,
      connectorName: pendingConnector.connectorName,
      connectorOrder: pendingConnector.connectorOrder,
      parkedAt: pendingConnector.parkedAt,
    },
  };
}
