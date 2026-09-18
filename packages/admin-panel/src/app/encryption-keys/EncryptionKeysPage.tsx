import { useState, type ReactElement } from 'react';
import { PageBody } from '@/components/ui/PageBody';
import { AddEncryptionKeyAction } from './components/AddEncryptionKeyAction/AddEncryptionKeyAction';
import { EncryptionKeyList } from './components/EncryptionKeyList/EncryptionKeyList';
import { ReEncryptionProgressBanner } from './components/ReEncryptionProgressBanner';
import { useEncryptionKeys } from './hooks/useEncryptionKeys';

/**
 * Composes the Encryption keys tab from `useEncryptionKeys` and its list/action components. No
 * design was supplied for this screen; it is built to match Connectors' layout, typography and
 * component vocabulary and is provisional pending one.
 */
export function EncryptionKeysPage(): ReactElement {
  const { phase, keys, reEncryption, error, refetch, adding, addKey } = useEncryptionKeys();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Encryption is off precisely when the engine reports no keys at all — a table with a working
  // key ring always holds at least the one it provisions itself at first boot.
  const encryptionDisabled = phase === 'ready' && keys.length === 0;

  async function handleAdd(): Promise<void> {
    const outcome = await addKey();

    if (outcome.ok) {
      setActionMessage('Added a new encryption key. Re-encryption has started in the background.');
    } else {
      setActionMessage(`Unable to add a key: ${outcome.error.message}`);
    }
  }

  let statusMessage: string;
  let emptyMessage = '';

  if (phase === 'loading') {
    statusMessage = 'Loading encryption keys…';
  } else if (phase === 'error') {
    statusMessage = error
      ? `Unable to load encryption keys: ${error.message}`
      : 'Unable to load encryption keys.';
  } else if (encryptionDisabled) {
    statusMessage = 'Encryption is not enabled.';
    emptyMessage = 'Encryption is not enabled, so there is no key history to show.';
  } else {
    statusMessage =
      actionMessage ?? `Showing ${keys.length} encryption key${keys.length === 1 ? '' : 's'}.`;
  }

  return (
    <PageBody>
      <AddEncryptionKeyAction
        disabled={phase !== 'ready' || encryptionDisabled}
        pending={adding}
        onAdd={() => {
          void handleAdd();
        }}
      />
      <ReEncryptionProgressBanner progress={reEncryption} onRefresh={refetch} />
      <EncryptionKeyList statusMessage={statusMessage} emptyMessage={emptyMessage} keys={keys} />
    </PageBody>
  );
}
