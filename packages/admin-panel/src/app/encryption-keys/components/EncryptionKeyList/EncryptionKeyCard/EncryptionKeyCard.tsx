import type { ReactElement } from 'react';
import { formatNullableDateTime, formatDateTime } from '@/lib/format-date-time';
import type { EncryptionKey } from '../../../types/encryption-key';

export interface EncryptionKeyCardProps {
  encryptionKey: EncryptionKey;
}

/**
 * One key's own row in the history: its id, its lifecycle timestamps, whether it is the one
 * `encrypt` currently uses, and — the one distinction an operator must not lose — whether it came
 * from the engine's own first-boot bootstrap or from a rotation an operator triggered. Never
 * renders anything beyond the id; the engine does not return key material and this card has no
 * field to put it in.
 */
export function EncryptionKeyCard({ encryptionKey }: EncryptionKeyCardProps): ReactElement {
  const provenance =
    encryptionKey.createdBy === null
      ? 'Provisioned automatically at first boot'
      : `Added by ${encryptionKey.createdBy}`;

  return (
    <div
      className="detail-card encryption-key-card"
      role="group"
      aria-label={`Encryption key ${encryptionKey.id}`}
    >
      <header className="encryption-key-card__header">
        <p className="encryption-key-card__id font-mono text-mono break-all text-fg-1">
          {encryptionKey.id}
        </p>
        <div className="connector-card__meta">
          <span className={encryptionKey.active ? 'chip chip--accent' : 'chip'}>
            {encryptionKey.active ? 'Active' : 'Superseded'}
          </span>
          <p className="connector-card__updated">{provenance}</p>
        </div>
      </header>

      <dl className="encryption-key-card__timestamps">
        <div>
          <dt>Created</dt>
          <dd>{formatDateTime(encryptionKey.createdAt)}</dd>
        </div>
        <div>
          <dt>Activated</dt>
          <dd>{formatDateTime(encryptionKey.activatedAt)}</dd>
        </div>
        <div>
          <dt>Deleted</dt>
          <dd>{formatNullableDateTime(encryptionKey.deletedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}
