import { ApiProperty } from '@nestjs/swagger';
import { ENCRYPTION_KEY_ROTATION_INTERVAL_ENUM } from '../../openapi/api-enums';
import type { EncryptionStateView } from '../encryption-admin.service';
import type { EncryptionKeyRotationInterval } from '../encryption-key-rotation';
import { EncryptionKeyResponseDto, toEncryptionKeyResponse } from './encryption-key.response.dto';

/**
 * Derived from the rows themselves, never a stored counter: `total` counts every onboarding,
 * `pending` the ones the background sweep still has to move toward the state the operator chose.
 */
export class SweepProgressResponseDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description:
      'Onboardings not yet in the chosen state: stored as plain JSON while encryption is on, ' +
      'still encrypted while it is off. A row on a superseded key is not pending — rotation is ' +
      'lazy, so it moves to the current key the next time it is written.',
  })
  pending!: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Every onboarding.' })
  total!: number;
}

/**
 * The automatic-rotation schedule the active key carries. Both fields are `null` while encryption
 * is off — the schedule lives on the key, so there is nothing to carry one — and `interval` alone
 * is `null` when an operator has turned automatic rotation off.
 */
export class EncryptionRotationResponseDto {
  @ApiProperty({
    ...ENCRYPTION_KEY_ROTATION_INTERVAL_ENUM,
    nullable: true,
    description:
      'How often the engine rotates the key on its own; `null` when it does not, and while ' +
      'encryption is off.',
  })
  interval!: EncryptionKeyRotationInterval | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      "When the next automatic rotation falls due: the active key's `createdAt` plus `interval`. " +
      'Null whenever `interval` is. In the past for a schedule that has come due but whose ' +
      'rotation the engine has not run yet — it checks every ' +
      '`ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS`.',
  })
  nextRotationAt!: string | null;
}

/** The state the operator chose, whether this process can change it, the key history, and the sweep's progress. */
export class EncryptionStateResponseDto {
  @ApiProperty({
    description:
      'Whether encryption is turned on: a key exists that has not been retired. `true` from the ' +
      'moment an operator turns it on, including the grace window before that key activates ' +
      '(`keys[].pendingActivation`); `false` from the moment it is turned off, including the ' +
      'grace window in which the retiring key still protects new writes (`keys[].active`).',
  })
  enabled!: boolean;

  @ApiProperty({
    description:
      'Whether this engine process holds the key-encryption key (`ENCRYPTION_KEY`). Without it, ' +
      'encryption cannot be turned on and no key can be added from this process.',
  })
  keyConfigured!: boolean;

  @ApiProperty({
    type: () => EncryptionKeyResponseDto,
    isArray: true,
    description: 'Every key that has ever protected `onboardings.context`, most recent first.',
  })
  keys!: EncryptionKeyResponseDto[];

  @ApiProperty({ type: () => EncryptionRotationResponseDto })
  rotation!: EncryptionRotationResponseDto;

  @ApiProperty({ type: () => SweepProgressResponseDto })
  progress!: SweepProgressResponseDto;
}

export function toEncryptionStateResponse(view: EncryptionStateView): EncryptionStateResponseDto {
  return {
    enabled: view.enabled,
    keyConfigured: view.keyConfigured,
    keys: view.keys.map(toEncryptionKeyResponse),
    rotation: {
      interval: view.rotation.interval,
      nextRotationAt: view.rotation.nextRotationAt?.toISOString() ?? null,
    },
    progress: { ...view.progress },
  };
}
