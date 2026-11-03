import { IDENTITY_DOCUMENT_PNG, uploadDocumentBytes } from '../engine/document-upload';
import { EngineClient, EngineError, type ProviderCallback } from '../engine/engine-client';
import { MailhogClient } from '../mailhog/mailhog-client';
import { ProviderReferenceReader } from '../provider/provider-reference-reader';
import {
  IDENTITY_DOCUMENT_CONTENT_TYPE,
  IDENTITY_DOCUMENT_FIELD,
  IDENTITY_PROVIDER_KEY,
  OTP_MAX_ATTEMPTS,
  REJECTION_REASONS,
  WORKFLOW_ID,
  WRONG_VERIFICATION_CODE,
} from '../workflow/analyst-investigation';
import {
  JOURNEY_STAGES,
  type IdentityVerdict,
  type JourneyStage,
  type ScenarioPlan,
} from './scenario-plan';

const HTTP_BAD_REQUEST = 400;
const INVALID_STEP_DATA = 'INVALID_STEP_DATA';

/** The callback the mock provider sends for each verdict, as `mock_async_callback_2` maps it. */
const CALLBACK_BY_VERDICT: Record<
  IdentityVerdict,
  (providerReference: string) => ProviderCallback
> = {
  approve: (providerReference) => ({
    providerReference,
    status: 'accepted',
    submittedData: { providerVerdict: 'approve' },
  }),
  review: (providerReference) => ({
    providerReference,
    status: 'accepted',
    submittedData: { providerVerdict: 'review' },
  }),
  reject: (providerReference) => ({
    providerReference,
    status: 'rejected',
    reason: REJECTION_REASONS.connectorRejected,
    submittedData: {},
  }),
};

export interface ScenarioRunnerDependencies {
  engine: EngineClient;
  mailhog: MailhogClient;
  providerReferences: ProviderReferenceReader;
  storageUrl: string;
}

/** Drives one planned onboarding through the engine's public API and checks where it ended. */
export class ScenarioRunner {
  constructor(private readonly dependencies: ScenarioRunnerDependencies) {}

  /** Starts the onboarding and drives it as far as the plan says; returns its id. */
  async execute(plan: ScenarioPlan): Promise<string> {
    const { engine } = this.dependencies;
    const { onboardingId } = await engine.request('post', '/v1/onboardings', {
      body: { workflowId: WORKFLOW_ID },
    });
    const { journey } = plan;

    if (journey.kind === 'advance') {
      await this.advance(onboardingId, plan, journey.stage);
    } else if (journey.kind === 'otp-exhausted') {
      await this.advance(onboardingId, plan, 'email_code_sent');
      await this.exhaustVerificationAttempts(onboardingId);
    } else {
      await this.advance(onboardingId, plan, 'identity_parked');

      if (!journey.deferred) {
        await this.answerAsProvider(onboardingId, journey.verdict);
      }
      if (journey.review) {
        await engine.request('post', '/v1/onboardings/{id}/review/{action}', {
          path: { id: onboardingId, action: journey.review },
        });
      }
    }

    return onboardingId;
  }

  /** Sends the provider callback of a scenario whose callback came later than its park. */
  async completeDeferred(plan: ScenarioPlan, onboardingId: string): Promise<void> {
    if (plan.journey.kind === 'identity-verdict' && plan.journey.deferred) {
      await this.answerAsProvider(onboardingId, plan.journey.verdict);
    }
  }

  /** Reads the onboarding back and fails unless it stands where the plan expects. */
  async verify(plan: ScenarioPlan, onboardingId: string): Promise<number> {
    const state = await this.dependencies.engine.request('get', '/v1/onboardings/{id}/state', {
      path: { id: onboardingId },
    });
    const { status, step } = plan.expected;

    if (state.status !== status || state.currentStep !== step) {
      throw new Error(
        `${plan.key}: expected ${status} at ${step ?? 'no step'}, the engine reports ${state.status} at ${state.currentStep ?? 'no step'}.`,
      );
    }

    return state.workflowVersion;
  }

  private async advance(
    onboardingId: string,
    plan: ScenarioPlan,
    stage: JourneyStage,
  ): Promise<void> {
    const reaches = (candidate: JourneyStage): boolean =>
      JOURNEY_STAGES.indexOf(stage) >= JOURNEY_STAGES.indexOf(candidate);
    let verificationCode = '';
    const submit = (body: Record<string, unknown>) =>
      this.dependencies.engine.request('post', '/v1/onboardings/{id}/submit', {
        path: { id: onboardingId },
        body,
      });

    if (reaches('profile_submitted')) {
      await submit({ ...plan.applicant });
    }
    if (reaches('email_code_sent')) {
      verificationCode = await this.requestEmailCode(onboardingId, plan.applicant.email);
    }
    if (reaches('email_verified')) {
      await submit({ verificationCode });
    }
    if (reaches('document_submitted')) {
      await submit({ [IDENTITY_DOCUMENT_FIELD]: await this.uploadIdentityDocument(onboardingId) });
    }
    if (reaches('identity_parked')) {
      await submit({});
    }
  }

  /** Submits the empty send step and returns the code it mailed. */
  private async requestEmailCode(onboardingId: string, email: string): Promise<string> {
    const { engine, mailhog } = this.dependencies;
    const known = await mailhog.listMessageIds(email);

    await engine.request('post', '/v1/onboardings/{id}/submit', {
      path: { id: onboardingId },
      body: {},
    });

    return mailhog.waitForOtpCode(email, known);
  }

  private async uploadIdentityDocument(onboardingId: string): Promise<string> {
    const { engine, storageUrl } = this.dependencies;
    const reservation = await engine.request('post', '/v1/onboardings/{id}/documents', {
      path: { id: onboardingId },
      body: {
        field: IDENTITY_DOCUMENT_FIELD,
        contentType: IDENTITY_DOCUMENT_CONTENT_TYPE,
        sizeBytes: IDENTITY_DOCUMENT_PNG.length,
      },
    });

    await uploadDocumentBytes(
      reservation.upload,
      storageUrl,
      IDENTITY_DOCUMENT_PNG,
      IDENTITY_DOCUMENT_CONTENT_TYPE,
    );
    await engine.request('post', '/v1/onboardings/{id}/documents/{documentId}/complete', {
      path: { id: onboardingId, documentId: reservation.documentId },
    });

    return reservation.documentId;
  }

  private async exhaustVerificationAttempts(onboardingId: string): Promise<void> {
    const { engine } = this.dependencies;

    for (let attempt = 1; attempt <= OTP_MAX_ATTEMPTS; attempt++) {
      try {
        await engine.request('post', '/v1/onboardings/{id}/submit', {
          path: { id: onboardingId },
          body: { verificationCode: WRONG_VERIFICATION_CODE },
        });
      } catch (error) {
        const refused =
          error instanceof EngineError &&
          error.status === HTTP_BAD_REQUEST &&
          error.code === INVALID_STEP_DATA;

        if (!refused || attempt === OTP_MAX_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  private async answerAsProvider(onboardingId: string, verdict: IdentityVerdict): Promise<void> {
    const { engine, providerReferences } = this.dependencies;
    const providerReference = await providerReferences.getProviderReference(onboardingId);

    await engine.postProviderCallback(
      IDENTITY_PROVIDER_KEY,
      CALLBACK_BY_VERDICT[verdict](providerReference),
    );
  }
}
