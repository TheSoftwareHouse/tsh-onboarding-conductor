import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import type { OnboardingJourneyStateDescriptor, OnboardingSafeHistoryItem } from '@tsh/shared';
import {
  OnboardingRequestError,
  getOnboardingHistory,
  getOnboardingState,
  startOnboarding,
  submitOnboarding,
} from './api/onboarding-client';
import { OnboardingStatus } from './components/onboarding-status';
import { DynamicContactForm } from './components/dynamic-contact-form';
import type { FieldErrors, FieldValues } from './components/dynamic-contact-form';
import { JourneyHistory } from './components/journey-history';

type Phase = 'idle' | 'starting' | 'journey' | 'failed';

export function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [descriptor, setDescriptor] = useState<OnboardingJourneyStateDescriptor | null>(null);
  const [formValues, setFormValues] = useState<FieldValues>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [history, setHistory] = useState<OnboardingSafeHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  const refreshHistory = useCallback(async (onboardingId: string) => {
    setHistoryLoading(true);
    try {
      const items = await getOnboardingHistory(onboardingId);
      setHistory(items);
    } catch {
      // The history disclosure is supplementary; a fetch failure here must not block the journey.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleStart = useCallback(async () => {
    setPhase('starting');
    setFailureMessage(null);
    try {
      const { onboardingId } = await startOnboarding();
      const state = await getOnboardingState(onboardingId);
      setDescriptor(state);
      setFormValues({});
      setFieldErrors({});
      setSubmitError(null);
      setPhase('journey');
      void refreshHistory(onboardingId);
    } catch (error) {
      const message =
        error instanceof OnboardingRequestError
          ? error.message
          : 'Unable to start the onboarding journey.';
      setFailureMessage(message);
      setPhase('failed');
    }
  }, [refreshHistory]);

  const handleFieldChange = useCallback((name: string, value: string | boolean) => {
    setFormValues((previous) => ({ ...previous, [name]: value }));
    setFieldErrors((previous) => {
      if (!(name in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[name];
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!descriptor?.currentStep) {
        return;
      }

      const step = descriptor.currentStep;
      const onboardingId = descriptor.onboardingId;
      const payload: Record<string, unknown> = {};
      for (const field of step.fields) {
        const value = formValues[field.name];
        if (field.type === 'boolean') {
          if (value === true) {
            payload[field.name] = true;
          }
          continue;
        }
        payload[field.name] = typeof value === 'string' ? value : '';
      }

      setSubmitting(true);
      setSubmitError(null);
      try {
        const outcome = await submitOnboarding(onboardingId, payload);
        if (outcome.ok) {
          const nextState = await getOnboardingState(onboardingId);
          setDescriptor(nextState);
          setFieldErrors({});
        } else {
          const nextFieldErrors: FieldErrors = {};
          for (const fieldError of outcome.problem.fieldErrors) {
            nextFieldErrors[fieldError.field] = fieldError.code;
          }
          setFieldErrors(nextFieldErrors);
        }
        void refreshHistory(onboardingId);
      } catch (error) {
        const message =
          error instanceof OnboardingRequestError
            ? error.message
            : 'Unable to submit your details.';
        setSubmitError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [descriptor, formValues, refreshHistory],
  );

  return (
    <main className="onboarding-app">
      <h1>Onboarding demo</h1>

      {phase === 'idle' ? (
        <button type="button" onClick={() => void handleStart()}>
          Start onboarding
        </button>
      ) : null}

      {phase === 'starting' ? <p>Starting your onboarding…</p> : null}

      {phase === 'failed' ? (
        <div className="onboarding-error" role="alert">
          <p>{failureMessage}</p>
          <button type="button" onClick={() => void handleStart()}>
            Try again
          </button>
        </div>
      ) : null}

      {phase === 'journey' && descriptor ? (
        <>
          <OnboardingStatus descriptor={descriptor} />

          {descriptor.status === 'approved' ? (
            <div className="onboarding-approved" role="status">
              <p>Your onboarding is approved.</p>
            </div>
          ) : descriptor.currentStep ? (
            <>
              {submitError ? (
                <div className="onboarding-error" role="alert">
                  <p>{submitError}</p>
                </div>
              ) : null}
              <DynamicContactForm
                step={descriptor.currentStep}
                values={formValues}
                fieldErrors={fieldErrors}
                submitting={submitting}
                onFieldChange={handleFieldChange}
                onSubmit={handleSubmit}
              />
            </>
          ) : null}

          <JourneyHistory items={history} loading={historyLoading} />
        </>
      ) : null}
    </main>
  );
}
