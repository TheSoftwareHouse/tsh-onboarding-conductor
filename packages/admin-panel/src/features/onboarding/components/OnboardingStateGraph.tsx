import type { ReactElement } from 'react';
import { formatDateTime } from '@/shared/lib/format-date-time';
import {
  describeAdminOnboardingStatus,
  describeAdminOnboardingStatusTone,
} from '../types/admin-onboarding';
import type { OnboardingTransition } from '../utils/onboarding-transitions';

export interface OnboardingStateGraphProps {
  transitions: OnboardingTransition[];
}

/**
 * The states the onboarding moved through, drawn as a top-to-bottom chain of nodes joined by
 * arrows. Each node is one recorded transition: the state entered, the status it put the
 * onboarding in, and when that happened.
 *
 * An ordered list carries the chain, so the order the nodes are read in is the order they were
 * reached in whether the arrows are visible or not.
 */
export function OnboardingStateGraph({ transitions }: OnboardingStateGraphProps): ReactElement {
  return (
    <ol className="flow">
      {transitions.map((transition) => (
        <li key={transition.id} className="flow__item">
          <article
            className={[
              'flow__node',
              `flow__node--${describeAdminOnboardingStatusTone(transition.status)}`,
              transition.current ? 'flow__node--current' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <p className="flow__label">{transition.label}</p>
            <p className="flow__meta">
              {describeAdminOnboardingStatus(transition.status)} ·{' '}
              {formatDateTime(transition.occurredAt)}
            </p>
            {transition.trigger !== null && (
              <p className="flow__meta">Triggered by {transition.trigger}</p>
            )}
            {transition.current && <p className="flow__badge">Current state</p>}
          </article>
        </li>
      ))}
    </ol>
  );
}
