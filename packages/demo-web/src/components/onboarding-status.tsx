import type { OnboardingJourneyStateDescriptor } from '@tsh/shared';

type OnboardingStatusProps = {
  descriptor: OnboardingJourneyStateDescriptor;
};

function humanizeStepId(stepId: string): string {
  return stepId
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeStatus(status: OnboardingJourneyStateDescriptor['status']): string {
  return status === 'approved' ? 'Approved' : 'Awaiting your input';
}

export function OnboardingStatus({ descriptor }: OnboardingStatusProps) {
  return (
    <section aria-labelledby="onboarding-status-heading" className="onboarding-status">
      <h2 id="onboarding-status-heading">Onboarding status</h2>
      <dl>
        <div className="onboarding-status-row">
          <dt>Onboarding ID</dt>
          <dd>{descriptor.onboardingId}</dd>
        </div>
        <div className="onboarding-status-row">
          <dt>Status</dt>
          <dd>{describeStatus(descriptor.status)}</dd>
        </div>
        <div className="onboarding-status-row">
          <dt>Current step</dt>
          <dd>{descriptor.currentStep ? humanizeStepId(descriptor.currentStep.stepId) : 'None'}</dd>
        </div>
      </dl>
    </section>
  );
}
