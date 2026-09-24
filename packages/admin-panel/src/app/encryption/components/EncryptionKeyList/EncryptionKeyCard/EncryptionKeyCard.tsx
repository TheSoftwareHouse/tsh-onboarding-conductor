import type { ReactElement } from 'react';
import { Chip, type ChipTone } from '@/components/ui/Chip/Chip';
import { formatDateTime, formatNullableDateTime } from '@/lib/format-date-time';
import type { EncryptionKey } from '@/api/encryption/admin-encryption';

export interface EncryptionKeyCardProps {
  encryptionKey: EncryptionKey;
}

interface KeyStatus {
  label: string;
  tone: ChipTone;
}

/** Active wins over pending, and a key that is neither has been superseded or retired. */
function describeKeyStatus(encryptionKey: EncryptionKey): KeyStatus {
  if (encryptionKey.active) {
    return { label: 'Active', tone: 'strong' };
  }
  if (encryptionKey.pendingActivation) {
    return { label: 'Pending activation', tone: 'attention' };
  }
  return { label: 'Retired', tone: 'neutral' };
}

/**
 * One key's own row in the history: its id, its lifecycle timestamps, where it stands in the ring,
 * and who asked for it. Every key the engine creates records the operator behind the request, so
 * a key with no creator was inserted outside the API and is labelled as such rather than
 * attributed to anyone. Never renders anything beyond the id; the engine does not return key
 * material and this card has no field to put it in.
 */
export function EncryptionKeyCard({ encryptionKey }: EncryptionKeyCardProps): ReactElement {
  const status = describeKeyStatus(encryptionKey);
  const provenance =
    encryptionKey.createdBy === null
      ? 'Added outside the panel'
      : `Added by ${encryptionKey.createdBy}`;

  return (
    <div
      role="group"
      aria-label={`Encryption key ${encryptionKey.id}`}
      className="flex flex-col gap-3 border border-border-rule bg-bg-page p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-md font-mono text-mono wrap-break-word text-fg-1">{encryptionKey.id}</p>
        <div className="flex flex-col items-start gap-1">
          <Chip tone={status.tone}>{status.label}</Chip>
          <span className="text-body-sm text-fg-3">{provenance}</span>
        </div>
      </div>

      <dl className="flex flex-wrap gap-6">
        <div>
          <dt className="text-caps-tiny text-fg-4 uppercase">Created</dt>
          <dd className="text-body-sm text-fg-2">{formatDateTime(encryptionKey.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-caps-tiny text-fg-4 uppercase">Activated</dt>
          <dd className="text-body-sm text-fg-2">{formatDateTime(encryptionKey.activatedAt)}</dd>
        </div>
        <div>
          <dt className="text-caps-tiny text-fg-4 uppercase">Deleted</dt>
          <dd className="text-body-sm text-fg-2">
            {formatNullableDateTime(encryptionKey.deletedAt)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
