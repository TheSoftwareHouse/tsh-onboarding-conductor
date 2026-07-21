import {
  OnboardingProblemDocument,
  OnboardingJourneyStateDescriptor,
  OnboardingSafeHistoryItem,
} from '@tsh/shared';
import { DemoBffAppConfig } from '../config/app.config';

export type StartOnboardingRequest = {
  workflowId: string;
};

export type StartOnboardingResponse = {
  onboardingId: string;
};

export type GetOnboardingResponse = OnboardingJourneyStateDescriptor;

export type GetOnboardingStateResponse = OnboardingJourneyStateDescriptor;

export type GetOnboardingHistoryResponse = OnboardingSafeHistoryItem[];

export type SubmitOnboardingRequest = Record<string, unknown>;

export type SubmitOnboardingResponse = OnboardingJourneyStateDescriptor | OnboardingProblemDocument;

export class EngineClient {
  constructor(private readonly config: DemoBffAppConfig) {}

  async start(payload: StartOnboardingRequest): Promise<StartOnboardingResponse> {
    return this.request<StartOnboardingResponse>('/v1/onboardings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async get(onboardingId: string): Promise<GetOnboardingResponse> {
    return this.request<GetOnboardingResponse>(
      `/v1/onboardings/${encodeURIComponent(onboardingId)}`,
    );
  }

  async getState(onboardingId: string): Promise<GetOnboardingStateResponse> {
    return this.request<GetOnboardingStateResponse>(
      `/v1/onboardings/${encodeURIComponent(onboardingId)}/state`,
    );
  }

  async getHistory(onboardingId: string): Promise<GetOnboardingHistoryResponse> {
    return this.request<GetOnboardingHistoryResponse>(
      `/v1/onboardings/${encodeURIComponent(onboardingId)}/history`,
    );
  }

  async submit(
    onboardingId: string,
    payload: SubmitOnboardingRequest,
  ): Promise<SubmitOnboardingResponse> {
    return this.request<SubmitOnboardingResponse>(
      `/v1/onboardings/${encodeURIComponent(onboardingId)}/submit`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.engineBaseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-engine-service-secret': this.config.engineServiceSecret,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      const body =
        contentType.includes('application/problem+json') || contentType.includes('application/json')
          ? await response.json()
          : await response.text();

      const error = new Error('Engine request failed') as Error & {
        status?: number;
        response?: T | OnboardingProblemDocument | string;
      };

      error.status = response.status;
      error.response = body;
      throw error;
    }

    return (await response.json()) as T;
  }
}
