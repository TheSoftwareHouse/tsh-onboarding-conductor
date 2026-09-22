import { useId, type ChangeEvent, type ReactElement } from 'react';
import { formatDateTime } from '@/lib/format-date-time';
import { ROTATION_INTERVAL_LABELS, ROTATION_INTERVALS } from '../../constants/rotation-intervals';
import type { EncryptionKeyRotationInterval, EncryptionRotation } from '../../types/encryption';

export interface RotationScheduleActionProps {
  /** The schedule in force and when it next falls due, as the engine reports them. */
  rotation: EncryptionRotation;
  /** True while nothing can be chosen — the engine has no key-encryption key, or another write is in flight. */
  disabled: boolean;
  /** True while this control's own request is in flight. */
  pending: boolean;
  onChange: (interval: EncryptionKeyRotationInterval | null) => void;
}

/** The empty option's value: a `<select>` carries strings, and "off" is `null` over the wire. */
const OFF_VALUE = '';

const OFF_LABEL = 'Off — rotate only on request';

/** What the schedule means for stored data right now, in one sentence under the control. */
function describeSchedule(rotation: EncryptionRotation): string {
  if (rotation.nextRotationAt === null) {
    return (
      'The engine rotates the key only when you add one. A rotation changes which key new data ' +
      'uses; stored onboardings move onto it as they are next written.'
    );
  }

  if (new Date(rotation.nextRotationAt).getTime() <= Date.now()) {
    return (
      'Due now: the engine rotates the key on its next check. Stored onboardings move onto the ' +
      'new key as they are next written.'
    );
  }

  return (
    `Next rotation ${formatDateTime(rotation.nextRotationAt)}. Counted from the active key's ` +
    'creation, so adding a key starts it over.'
  );
}

/**
 * How often the engine rotates the key on its own. A plain select applied on change rather than a
 * two-click confirm like the actions beside it: choosing a schedule is not itself the destructive
 * act — the rotation it eventually causes is, and that one is announced below the control, since
 * an interval shorter than the active key's current age falls due immediately.
 *
 * Styled to match the filter controls elsewhere in the panel; the panel has no shared select
 * primitive and this does not introduce one for a single use.
 */
export function RotationScheduleAction({
  rotation,
  disabled,
  pending,
  onChange,
}: RotationScheduleActionProps): ReactElement {
  const selectId = useId();

  return (
    <section
      aria-label="Key rotation schedule"
      className="flex max-w-2xl flex-col gap-2 border border-border-rule bg-bg-subtle p-5"
    >
      <label htmlFor={selectId} className="text-caps-tiny text-fg-3 uppercase">
        Automatic key rotation
      </label>
      <select
        id={selectId}
        name="rotation-interval"
        disabled={disabled || pending}
        value={rotation.interval ?? OFF_VALUE}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onChange(
            event.target.value === OFF_VALUE
              ? null
              : (event.target.value as EncryptionKeyRotationInterval),
          )
        }
        className="h-10 w-72 rounded-none border border-border-strong bg-bg-page px-3 text-body-sm text-fg-1 enabled:hover:border-tsh-black disabled:text-fg-disabled"
      >
        <option value={OFF_VALUE}>{OFF_LABEL}</option>
        {ROTATION_INTERVALS.map((interval) => (
          <option key={interval} value={interval}>
            {ROTATION_INTERVAL_LABELS[interval]}
          </option>
        ))}
      </select>
      <p className="text-body-sm text-fg-2">{describeSchedule(rotation)}</p>
    </section>
  );
}
