import type { OnboardingSafeHistoryItem } from '@tsh/shared';

type JourneyHistoryProps = {
  items: readonly OnboardingSafeHistoryItem[];
  loading: boolean;
};

function humanizeStepId(stepId: string): string {
  return stepId
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeEvent(item: OnboardingSafeHistoryItem): string {
  return item.event === 'transitioned' ? 'Step completed' : 'Correction needed';
}

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleString();
}

export function JourneyHistory({ items, loading }: JourneyHistoryProps) {
  return (
    <details className="onboarding-history">
      <summary>Journey history ({items.length})</summary>
      {loading ? (
        <p>Loading history…</p>
      ) : items.length === 0 ? (
        <p>No history yet.</p>
      ) : (
        <ol>
          {items.map((item, index) => (
            <li key={`${item.timestamp}-${index}`}>
              <p>
                <strong>{describeEvent(item)}</strong> — {humanizeStepId(item.appliedStep)} (
                {formatTimestamp(item.timestamp)})
              </p>
              <p>
                Resulting status: {item.resultingStatus}
                {item.resultingCurrentStep
                  ? `, step: ${humanizeStepId(item.resultingCurrentStep)}`
                  : ''}
              </p>
              {item.fieldErrors && item.fieldErrors.length > 0 ? (
                <p>
                  Rejected fields:{' '}
                  {item.fieldErrors
                    .map((fieldError) => `${fieldError.field} (${fieldError.code})`)
                    .join(', ')}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
