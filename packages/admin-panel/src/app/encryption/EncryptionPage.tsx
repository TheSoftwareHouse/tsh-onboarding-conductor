import { useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { PageBody } from '@/components/ui/PageBody';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { AddEncryptionKeyAction } from './components/AddEncryptionKeyAction/AddEncryptionKeyAction';
import { EncryptionKeyList } from './components/EncryptionKeyList/EncryptionKeyList';
import { EncryptionStatus } from './components/EncryptionStatus/EncryptionStatus';
import { EncryptionToggleAction } from './components/EncryptionToggleAction/EncryptionToggleAction';
import { RotationScheduleAction } from './components/RotationScheduleAction/RotationScheduleAction';
import { SweepProgress } from './components/SweepProgress/SweepProgress';
import { ROTATION_INTERVAL_LABELS } from './constants/rotation-intervals';
import { useEncryption } from './hooks/useEncryption';
import type { EncryptionKeyRotationInterval, EncryptionState } from './types/encryption';
import { describeEncryptionStatus, ENCRYPTION_STATUS_LABELS } from './utils/encryption-status';

const TOGGLE_SUCCESS_MESSAGES: Record<'on' | 'off', string> = {
  on: 'Encryption turned on. Existing onboardings are being encrypted in the background.',
  off: 'Encryption turned off. Existing onboardings are being decrypted in the background.',
};

const ADD_KEY_SUCCESS_MESSAGE =
  'Added a new encryption key. New data uses it once it activates; stored onboardings move onto ' +
  'it as they are next written.';

const ROTATION_OFF_SUCCESS_MESSAGE =
  'Automatic key rotation turned off. The key now changes only when you add one.';

function summarize(state: EncryptionState): string {
  const status = ENCRYPTION_STATUS_LABELS[describeEncryptionStatus(state)].toLowerCase();
  const count = state.keys.length;

  return `Encryption is ${status}. Showing ${count} encryption key${count === 1 ? '' : 's'}.`;
}

/**
 * Composes the Encryption section from `useEncryption`: the state card, the on/off toggle and
 * key rotation behind their confirms, the automatic-rotation schedule, the sweep's progress, and
 * the key history. The schedule and the rotate-now action appear only while encryption is on —
 * both act on the active key, and while it is off there is none. The last action's
 * outcome replaces the summary in the status line until the next one. No design was supplied for
 * this screen; it uses the Tailwind primitives the other sections are built from.
 */
export function EncryptionPage(): ReactElement {
  const { phase, state, error, refetch, pendingAction, setEnabled, setRotationInterval, addKey } =
    useEncryption();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleToggle(enabled: boolean): Promise<void> {
    const direction = enabled ? 'on' : 'off';
    const outcome = await setEnabled(enabled);

    setActionMessage(
      outcome.ok
        ? TOGGLE_SUCCESS_MESSAGES[direction]
        : `Unable to turn encryption ${direction}: ${outcome.error.message}`,
    );
  }

  async function handleRotationChange(
    interval: EncryptionKeyRotationInterval | null,
  ): Promise<void> {
    const outcome = await setRotationInterval(interval);

    if (!outcome.ok) {
      setActionMessage(`Unable to change automatic key rotation: ${outcome.error.message}`);
      return;
    }

    setActionMessage(
      interval === null
        ? ROTATION_OFF_SUCCESS_MESSAGE
        : `Automatic key rotation set to: ${ROTATION_INTERVAL_LABELS[interval].toLowerCase()}.`,
    );
  }

  async function handleAddKey(): Promise<void> {
    const outcome = await addKey();

    setActionMessage(
      outcome.ok ? ADD_KEY_SUCCESS_MESSAGE : `Unable to add a key: ${outcome.error.message}`,
    );
  }

  let statusMessage: string;

  if (phase === 'loading') {
    statusMessage = 'Loading encryption settings…';
  } else if (phase === 'error') {
    statusMessage = error
      ? `Unable to load encryption settings: ${error.message}`
      : 'Unable to load encryption settings.';
  } else {
    statusMessage = actionMessage ?? (state ? summarize(state) : 'Encryption settings loaded.');
  }

  const ready = phase === 'ready' && state !== null;
  const writePending = pendingAction !== null;

  return (
    <PageBody>
      <StatusRegion>{statusMessage}</StatusRegion>
      {ready && (
        <>
          <EncryptionStatus state={state} />
          <div className="flex flex-wrap items-center gap-3">
            <EncryptionToggleAction
              enabled={state.enabled}
              disabled={!state.keyConfigured || writePending}
              pending={pendingAction === 'toggle'}
              onToggle={(enabled) => {
                void handleToggle(enabled);
              }}
            />
            {state.enabled && (
              <AddEncryptionKeyAction
                disabled={!state.keyConfigured || writePending}
                pending={pendingAction === 'add-key'}
                onAdd={() => {
                  void handleAddKey();
                }}
              />
            )}
            <Button variant="quiet" onClick={refetch}>
              Refresh
            </Button>
          </div>
          {state.enabled && (
            <RotationScheduleAction
              rotation={state.rotation}
              disabled={!state.keyConfigured || writePending}
              pending={pendingAction === 'rotation'}
              onChange={(interval) => {
                void handleRotationChange(interval);
              }}
            />
          )}
          <SweepProgress enabled={state.enabled} progress={state.progress} />
          <EncryptionKeyList keys={state.keys} />
        </>
      )}
    </PageBody>
  );
}
