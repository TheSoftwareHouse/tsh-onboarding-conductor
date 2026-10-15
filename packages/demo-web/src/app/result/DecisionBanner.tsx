import type { Decision } from '@/api/bnpl/bnpl.client';
import { cn } from '@/lib/utils';

const COPY: Record<Decision, { label: string; detail: string; tone: string }> = {
  approved: {
    label: 'Approved',
    detail: 'Your credit check passed.',
    tone: 'border-success bg-success/15',
  },
  review: {
    label: 'Under review',
    detail: 'An operator will review your application.',
    tone: 'border-warning bg-warning/20',
  },
  declined: {
    label: 'Declined',
    detail: 'Your credit check did not pass.',
    tone: 'border-destructive bg-destructive/10',
  },
};

export interface DecisionBannerProps {
  decision: Decision;
  score?: number;
  band?: string;
}

export function DecisionBanner({ decision, score, band }: DecisionBannerProps) {
  const copy = COPY[decision];

  return (
    <section
      aria-label="Credit decision"
      data-decision={decision}
      className={cn(
        'flex flex-wrap items-center justify-between gap-4 rounded-lg border p-6',
        copy.tone,
      )}
    >
      <div>
        <h1 className="text-3xl font-light tracking-display text-card-foreground">{copy.label}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.detail}</p>
      </div>
      <dl className="flex gap-8">
        <div>
          <dt className="text-xs text-muted-foreground uppercase">Score</dt>
          <dd className="text-2xl font-medium text-card-foreground">{score ?? 'n/a'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground uppercase">Band</dt>
          <dd className="text-2xl font-medium text-card-foreground capitalize">{band ?? 'n/a'}</dd>
        </div>
      </dl>
    </section>
  );
}
