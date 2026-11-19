import type { ReactElement } from 'react';
import { Chip, type ChipTone } from '@/components/ui/Chip/Chip';
import {
  describeAuditActorTone,
  describeAuditActorType,
  hasAuditActorIdentity,
  type AuditActorTone,
} from '../../../../../utils/describe-audit-events';

export interface AuditActorCellProps {
  actorType: string;
  actorId: string;
  /** The row's allowlisted metadata, which carries the operator's email or, on older rows, their Entra identity. */
  metadata?: Record<string, unknown>;
}

/** Metadata keys naming the operator, best first: the current `email`, then the legacy Entra ones. */
const IDENTITY_METADATA_KEYS = ['email', 'userPrincipalName', 'objectId'];

function readIdentity(actorId: string, metadata: Record<string, unknown>): string {
  for (const key of IDENTITY_METADATA_KEYS) {
    const value = metadata[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return actorId;
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
export function AuditActorCell({
  actorType,
  actorId,
  metadata = {},
}: AuditActorCellProps): ReactElement {
  return (
    <div className="flex flex-col items-start gap-1">
      <Chip tone={TONE_BY_ACTOR_TONE[describeAuditActorTone(actorType)]}>
        {describeAuditActorType(actorType)}
      </Chip>
      {hasAuditActorIdentity(actorType) && (
        <span className="text-caps-tiny wrap-break-word text-fg-4">
          {readIdentity(actorId, metadata)}
        </span>
      )}
    </div>
  );
}
