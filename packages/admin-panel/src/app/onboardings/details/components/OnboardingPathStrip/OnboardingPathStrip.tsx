import type { ReactElement } from 'react';
import { SectionHeader } from '@/components/ui/SectionHeader/SectionHeader';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format-date-time';
import { tv } from '@/lib/tv';
import type { OnboardingTransition } from '@/api/onboardings/onboarding-transitions';
import { describeAdminOnboardingStatus } from '../../../types/admin-onboarding';

export interface OnboardingPathStripProps {
  transitions: OnboardingTransition[];
  /** True when the trail holds more moves than one request reads, so the chain starts mid-journey. */
  truncated: boolean;
}

const PATH_STRIP_TITLE = 'Path taken';

const stepCard = tv({
  base: 'flex min-w-37 flex-none flex-col gap-[3px] border-tsh-black bg-tsh-white px-3 py-2',
  variants: {
    current: {
      true: 'border-2 bg-tsh-yellow-400 px-[11px] py-[7px]',
      false: 'border',
    },
  },
  defaultVariants: { current: false },
});

/** The band's own caption: how many steps it drew, and whether earlier ones were left out of them. */
function describeSteps(count: number, truncated: boolean): string {
  return truncated ? `${count} most recent steps · earlier steps not shown` : `${count} steps`;
}

/** History tab's "Path taken" band: the transitions chain as step cards joined by rules, current one amber. */
export function OnboardingPathStrip({
  transitions,
  truncated,
}: OnboardingPathStripProps): ReactElement {
  return (
    <section className="border-b border-border-rule">
      <SectionHeader title={PATH_STRIP_TITLE} meta={describeSteps(transitions.length, truncated)} />
      {transitions.length === 0 ? (
        <Typography variant="body-sm" className="px-8 py-6 text-fg-3">
          No steps recorded yet.
        </Typography>
      ) : (
        <div
          className="overflow-x-auto px-8 py-6"
          role="region"
          aria-label={PATH_STRIP_TITLE}
          tabIndex={0}
        >
          <ol className="flex min-w-max items-stretch">
            {transitions.map((transition, index) => (
              <li key={transition.id} className="flex items-center">
                {index > 0 && (
                  <span aria-hidden="true" className="h-px w-5 flex-none bg-tsh-black" />
                )}
                <article className={stepCard({ current: transition.current })}>
                  <Typography variant="mono" as="span" className="whitespace-nowrap text-fg-1">
                    {transition.enteredStep ?? describeAdminOnboardingStatus(transition.status)}
                  </Typography>
                  <Typography
                    variant="meta"
                    as="span"
                    className={cn(
                      'whitespace-nowrap',
                      transition.current ? 'text-fg-1' : 'text-fg-3',
                    )}
                  >
                    {transition.current
                      ? `Here since ${formatDateTime(transition.occurredAt)}`
                      : formatDateTime(transition.occurredAt)}
                  </Typography>
                </article>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
