import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OnboardingJourneyStateDescriptor, OnboardingProblemDocument } from '@tsh/shared';
import { DemoBffAppConfig } from '../config/app.config';
import { EngineClient, StartOnboardingResponse } from '../engine/engine.client';

export type StartDemoOnboardingRequest = {
  workflowKey: string;
};

@Injectable()
export class DemoOnboardingsService {
  constructor(
    private readonly engineClient: EngineClient,
    private readonly config: Pick<DemoBffAppConfig, 'demoWorkflowId'>,
  ) {}

  async start(payload: StartDemoOnboardingRequest): Promise<StartOnboardingResponse> {
    try {
      return await this.engineClient.start({
        workflowId: this.resolveWorkflowId(payload),
      });
    } catch (error) {
      throw this.mapEngineError(error);
    }
  }

  async get(onboardingId: string) {
    try {
      return await this.engineClient.get(onboardingId);
    } catch (error) {
      throw this.mapEngineError(error);
    }
  }

  async getState(onboardingId: string): Promise<OnboardingJourneyStateDescriptor> {
    try {
      return await this.engineClient.getState(onboardingId);
    } catch (error) {
      throw this.mapEngineError(error);
    }
  }

  async getHistory(onboardingId: string) {
    try {
      return await this.engineClient.getHistory(onboardingId);
    } catch (error) {
      throw this.mapEngineError(error);
    }
  }

  async submit(onboardingId: string, payload: Record<string, unknown>) {
    try {
      return await this.engineClient.submit(onboardingId, payload);
    } catch (error) {
      throw this.mapEngineError(error);
    }
  }

  private mapEngineError(error: unknown): HttpException {
    const candidate = error as Error & { status?: number; response?: unknown };

    if (candidate?.status === 400 && this.isProblemDocument(candidate.response)) {
      return new HttpException(candidate.response, HttpStatus.BAD_REQUEST);
    }

    if (
      (candidate?.status === 404 || candidate?.status === 409) &&
      candidate.response !== undefined &&
      candidate.response !== null
    ) {
      return new HttpException(candidate.response, candidate.status);
    }

    if (candidate?.status === 400) {
      return new HttpException(
        {
          type: '/problems/upstream-unavailable',
          title: 'Upstream service unavailable',
          status: 502,
          code: 'UPSTREAM_UNAVAILABLE',
          fieldErrors: [],
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (candidate?.status && candidate.status >= 400) {
      return new HttpException(
        {
          type: '/problems/upstream-unavailable',
          title: 'Upstream service unavailable',
          status: 502,
          code: 'UPSTREAM_UNAVAILABLE',
          fieldErrors: [],
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    return new HttpException(
      {
        type: '/problems/upstream-unavailable',
        title: 'Upstream service unavailable',
        status: 502,
        code: 'UPSTREAM_UNAVAILABLE',
        fieldErrors: [],
      },
      HttpStatus.BAD_GATEWAY,
    );
  }

  private isProblemDocument(value: unknown): value is OnboardingProblemDocument {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<OnboardingProblemDocument>;
    return Boolean(
      candidate.type &&
      candidate.title &&
      candidate.status === 400 &&
      candidate.code === 'INVALID_STEP_DATA',
    );
  }

  private resolveWorkflowId(payload: StartDemoOnboardingRequest): string {
    return payload.workflowKey.trim() === 'base'
      ? this.config.demoWorkflowId
      : payload.workflowKey.trim();
  }
}
