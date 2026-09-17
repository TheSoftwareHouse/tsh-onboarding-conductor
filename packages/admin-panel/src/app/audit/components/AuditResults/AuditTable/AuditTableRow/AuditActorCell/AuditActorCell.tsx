import type { ReactElement } from 'react';
import { Chip, type ChipTone } from '@/components/ui/Chip/Chip';
import {
  describeAuditActorTone,
  describeAuditActorType,
  hasAuditActorIdentity,
  type AuditActorTone,
} from '../../../../../types/audit-event';

export interface AuditActorCellProps {
  actorType: string;
  actorId: string;
}

const TONE_BY_ACTOR_TONE: Record<AuditActorTone, ChipTone> = {
  operator: 'scheduled',
  other: 'neutral',
};

/**
 * The design's two-line actor cell: a tone-coded chip over the raw actor id. The second line is
 * dropped for the actor types whose id is a placeholder rather than an identity — see
 * `hasAuditActorIdentity`.
 *
 * `items-start` is what keeps the chip the width of its own label: a column flex container
 * stretches its children by default, and the table's fixed column width would otherwise be the
 * chip's width, turning a short tag into a full-cell block.
 */
export function AuditActorCell({ actorType, actorId }: AuditActorCellProps): ReactElement {
  return (
    <div className="flex flex-col items-start gap-1">
      <Chip tone={TONE_BY_ACTOR_TONE[describeAuditActorTone(actorType)]}>
        {describeAuditActorType(actorType)}
      </Chip>
      {hasAuditActorIdentity(actorType) && (
        <span className="text-caps-tiny wrap-break-word text-fg-4">{actorId}</span>
      )}
    </div>
  );
}
