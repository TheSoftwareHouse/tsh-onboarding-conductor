import { ApiProperty } from '@nestjs/swagger';
import type { EncryptionKeysView } from '../encryption-admin.service';
import { EncryptionKeyResponseDto, toEncryptionKeyResponse } from './encryption-key.response.dto';

/**
 * Derived from the sweep's own predicate (never a stored counter): `total` counts every
 * onboarding row carrying an encryption envelope, `pending` the ones still naming a key other
 * than the currently active one.
 */
export class ReEncryptionProgressResponseDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Onboarding contexts still naming a key other than the active one.',
  })
  pending!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Every onboarding context carrying an encryption envelope.',
  })
  total!: number;
}

/** The full key history, most recent first, plus re-encryption progress toward the active key. */
export class EncryptionKeysResponseDto {
  @ApiProperty({ type: () => EncryptionKeyResponseDto, isArray: true })
  keys!: EncryptionKeyResponseDto[];

  @ApiProperty({ type: () => ReEncryptionProgressResponseDto })
  reEncryption!: ReEncryptionProgressResponseDto;
}

export function toEncryptionKeysResponse(view: EncryptionKeysView): EncryptionKeysResponseDto {
  return {
    keys: view.keys.map(toEncryptionKeyResponse),
    reEncryption: { ...view.reEncryption },
  };
}
