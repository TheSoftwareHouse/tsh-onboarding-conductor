import { NotComputed } from './NotComputed';
import type { PaymentScore } from './report-selectors';

export function PaymentScoreTab({ score }: { score: PaymentScore | null }) {
  if (!score) {
    return <NotComputed what="payment score" />;
  }
  const steps = Array.from({ length: score.scale }, (_, index) => index + 1);

  return (
    <div className="grid gap-4" data-testid="payment-score">
      <p className="text-4xl font-semibold text-card-foreground">
        {score.value}
        <span className="text-base font-normal text-muted-foreground"> / {score.scale}</span>
      </p>
      <ol className="flex gap-1" aria-label={`Payment score ${score.value} of ${score.scale}`}>
        {steps.map((step) => {
          const active = step === Math.round(score.value);
          return (
            <li
              key={step}
              aria-current={active ? 'true' : undefined}
              className={
                active
                  ? 'flex h-12 flex-1 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground'
                  : 'flex h-12 flex-1 items-center justify-center rounded-md bg-secondary text-sm text-muted-foreground'
              }
            >
              {step}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        Scale 1 (weakest) to {score.scale} (strongest)
        {score.version ? `. Model version ${score.version}` : ''}
      </p>
    </div>
  );
}
