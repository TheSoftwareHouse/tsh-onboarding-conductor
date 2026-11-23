import type { ReactElement } from 'react';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Typography } from '@/components/ui/Typography/Typography';
import type { EncryptionKey } from '@/api/encryption/admin-encryption';
import { EncryptionKeyCard } from './EncryptionKeyCard/EncryptionKeyCard';

export interface EncryptionKeyListProps {
  /** Most recent first — the order the engine returns them in. */
  keys: EncryptionKey[];
}

const EMPTY_TITLE = 'No encryption keys yet';
const EMPTY_BODY = 'Turn encryption on to create the first one.';

/** The key history under its own heading: one card per key, or the empty message. */
export function EncryptionKeyList({ keys }: EncryptionKeyListProps): ReactElement {
  return (
    <section
      aria-labelledby="encryption-key-history-heading"
      className="flex max-w-2xl flex-col gap-3"
    >
      <Typography
        variant="caps-tiny"
        as="h2"
        id="encryption-key-history-heading"
        className="text-fg-3"
      >
        Keys
      </Typography>
      {keys.length === 0 ? (
        <EmptyState layout="section" title={EMPTY_TITLE} body={EMPTY_BODY} />
      ) : (
        <div className="flex flex-col gap-4">
          {keys.map((key) => (
            <EncryptionKeyCard key={key.id} encryptionKey={key} />
          ))}
        </div>
      )}
    </section>
  );
}
