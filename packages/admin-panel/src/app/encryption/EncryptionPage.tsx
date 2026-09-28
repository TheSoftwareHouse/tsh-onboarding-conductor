import type { ReactElement } from 'react';
import type { AdminPageProps } from '@/lib/admin-page';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import {
  showErrorToast,
  showProgressToast,
  showSuccessToast,
} from '@/components/ui/Toast/toast-manager';
import { AddEncryptionKeyAction } from './components/AddEncryptionKeyAction/AddEncryptionKeyAction';
import { EncryptionKeyList } from './components/EncryptionKeyList/EncryptionKeyList';
import { EncryptionStatus } from './components/EncryptionStatus/EncryptionStatus';
import { EncryptionToggleAction } from './components/EncryptionToggleAction/EncryptionToggleAction';
import { ReencryptAction } from './components/ReencryptAction/ReencryptAction';
import { RotationScheduleAction } from './components/RotationScheduleAction/RotationScheduleAction';
import { SweepProgress } from './components/SweepProgress/SweepProgress';
import {
  ADD_KEY_SUCCESS_TITLE,
  REENCRYPT_ACCEPTED_TITLE,
  ROTATION_OFF_SUCCESS_TITLE,
  rotationSetTitle,
  TOGGLE_ACCEPTED_TITLE,
  UNABLE_TO_ADD_KEY_TITLE,
  UNABLE_TO_CHANGE_ROTATION_TITLE,
  UNABLE_TO_REENCRYPT_TITLE,
  UNABLE_TO_TOGGLE_TITLE,
} from './constants/encryption-toasts';
import { useEncryption } from './hooks/useEncryption';
import { useSettledChangeToast } from './hooks/useSettledChangeToast';
import type {
  EncryptionKeyRotationInterval,
  EncryptionState,
} from '@/api/encryption/admin-encryption';
import { describeEncryptionStatus, ENCRYPTION_STATUS_LABELS } from './utils/encryption-status';

function summarize(state: EncryptionState): string {
  const status = ENCRYPTION_STATUS_LABELS[describeEncryptionStatus(state)].toLowerCase();
  const count = state.keys.length;

  return `Encryption is ${status}. Showing ${count} encryption key${count === 1 ? '' : 's'}.`;
}

/**
 * Composes the Encryption section from `useEncryption`: the state card, the on/off toggle and
 * key rotation behind their confirms, the automatic-rotation schedule, the sweep's progress, and
 * the key history. The schedule and the rotate-now action appear only while encryption is on —
 * both act on the active key, and while it is off there is none. Every write reports its outcome
 * through a toast; a toggle or re-encrypt raises a second, settled toast once
 * `useSettledChangeToast` sees the background change finish. No design was supplied for this
 * screen; it uses the Tailwind primitives the other sections are built from.
 */
export function EncryptionPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const { phase, state, error, pendingAction, setEnabled, setRotationInterval, addKey, reencrypt } =
    useEncryption();
  const { notifyPending } = useSettledChangeToast(state);

  async function handleToggle(enabled: boolean): Promise<void> {
    const direction = enabled ? 'on' : 'off';
    const outcome = await setEnabled(enabled);

    if (outcome.ok) {
      showProgressToast(TOGGLE_ACCEPTED_TITLE[direction]);
      notifyPending(direction, outcome.state);
    } else {
      showErrorToast(UNABLE_TO_TOGGLE_TITLE[direction], outcome.error.message);
    }
  }

  async function handleRotationChange(
    interval: EncryptionKeyRotationInterval | null,
  ): Promise<void> {
    const outcome = await setRotationInterval(interval);

    if (!outcome.ok) {
      showErrorToast(UNABLE_TO_CHANGE_ROTATION_TITLE, outcome.error.message);
      return;
    }

    showSuccessToast(interval === null ? ROTATION_OFF_SUCCESS_TITLE : rotationSetTitle(interval));
  }

  async function handleAddKey(): Promise<void> {
    const outcome = await addKey();

    if (outcome.ok) {
      showSuccessToast(ADD_KEY_SUCCESS_TITLE);
    } else {
      showErrorToast(UNABLE_TO_ADD_KEY_TITLE, outcome.error.message);
    }
  }

  async function handleReencrypt(): Promise<void> {
    const outcome = await reencrypt();

    if (outcome.ok) {
      showProgressToast(REENCRYPT_ACCEPTED_TITLE);
      notifyPending('reencrypt', outcome.state);
    } else {
      showErrorToast(UNABLE_TO_REENCRYPT_TITLE, outcome.error.message);
    }
  }

  let statusMessage: string;

  if (phase === 'loading') {
    statusMessage = 'Loading encryption settings…';
  } else if (phase === 'error') {
    statusMessage = error
      ? `Unable to load encryption settings: ${error.message}`
      : 'Unable to load encryption settings.';
  } else {
    statusMessage = state ? summarize(state) : 'Encryption settings loaded.';
  }

  const ready = phase === 'ready' && state !== null;
  const writePending = pendingAction !== null;

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title}>
        <StatusRegion>{statusMessage}</StatusRegion>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-8">
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
              {state.enabled && (
                <ReencryptAction
                  active={state.reencrypting}
                  disabled={!state.keyConfigured || writePending}
                  pending={pendingAction === 'reencrypt'}
                  onRequest={() => {
                    void handleReencrypt();
                  }}
                />
              )}
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
      </div>
    </>
  );
}
