import { ApiProperty } from '@nestjs/swagger';
import type { EncryptionStateView } from '../encryption-admin.service';
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
      'Onboardings not yet in the chosen state: stored as plain JSON or on an older key while ' +
      'encryption is on, still encrypted while it is off.',
  })
  pending!: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Every onboarding.' })
  total!: number;
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

  @ApiProperty({ type: () => SweepProgressResponseDto })
  progress!: SweepProgressResponseDto;
}

export function toEncryptionStateResponse(view: EncryptionStateView): EncryptionStateResponseDto {
  return {
    enabled: view.enabled,
    keyConfigured: view.keyConfigured,
    keys: view.keys.map(toEncryptionKeyResponse),
    progress: { ...view.progress },
  };
}
