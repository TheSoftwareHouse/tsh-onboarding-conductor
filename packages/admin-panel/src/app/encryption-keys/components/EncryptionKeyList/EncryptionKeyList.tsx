import type { ReactElement } from 'react';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import type { EncryptionKey } from '../../types/encryption-key';
import { EncryptionKeyCard } from './EncryptionKeyCard/EncryptionKeyCard';

export interface EncryptionKeyListProps {
  statusMessage: string;
  emptyMessage: string;
  keys: EncryptionKey[];
}

/**
 * The polite live-region status line, then one card per key, most recent first — the order the
 * engine already returns them in — or the empty message.
 */
export function EncryptionKeyList({
  statusMessage,
  emptyMessage,
  keys,
}: EncryptionKeyListProps): ReactElement {
  return (
    <>
      <StatusRegion>{statusMessage}</StatusRegion>
      {keys.length === 0 ? (
        <p className="text-body-sm text-fg-3">{emptyMessage}</p>
      ) : (
        <div className="encryption-key-list">
          {keys.map((key) => (
            <EncryptionKeyCard key={key.id} encryptionKey={key} />
          ))}
        </div>
      )}
    </>
  );
}
