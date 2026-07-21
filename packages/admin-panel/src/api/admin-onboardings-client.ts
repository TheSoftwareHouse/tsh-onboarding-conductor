export type AdminOnboardingSummary = {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: 'awaiting_user' | 'approved';
  currentStep: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AdminOnboardingsFilters = {
  status?: string;
  workflowId?: string;
  workflowVersion?: number;
  currentStep?: string;
  onboardingId?: string;
};

const genericClientErrorMessage = 'Unable to load admin onboardings.';

export async function getAdminOnboardings(
  filters: AdminOnboardingsFilters = {},
): Promise<AdminOnboardingSummary[]> {
  const engineBaseUrl = import.meta.env.VITE_ADMIN_PANEL_ENGINE_BASE_URL?.trim();

  if (!engineBaseUrl) {
    throw new Error(genericClientErrorMessage);
  }

  const params = new URLSearchParams();

  const appendFilter = (key: keyof AdminOnboardingsFilters, value: unknown) => {
    if (typeof value === 'string') {
      const trimmedValue = value.trim();

      if (trimmedValue) {
        params.set(key, trimmedValue);
      }

      return;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      params.set(key, String(value));
    }
  };

  appendFilter('status', filters.status);
  appendFilter('workflowId', filters.workflowId);
  appendFilter('workflowVersion', filters.workflowVersion);
  appendFilter('currentStep', filters.currentStep);
  appendFilter('onboardingId', filters.onboardingId);

  const queryString = params.toString();
  const url = `${engineBaseUrl}/v1/admin/onboardings${queryString ? `?${queryString}` : ''}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(genericClientErrorMessage);
    }

    return (await response.json()) as AdminOnboardingSummary[];
  } catch (error) {
    if (error instanceof Error && error.message === genericClientErrorMessage) {
      throw error;
    }

    throw new Error(genericClientErrorMessage);
  }
}
