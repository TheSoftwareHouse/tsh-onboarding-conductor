import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ENCRYPTION_KEY_ROTATION_INTERVAL_ENUM } from '../../openapi/api-enums';
import {
  ENCRYPTION_KEY_ROTATION_INTERVALS,
  type EncryptionKeyRotationInterval,
} from '../encryption-key-rotation';

/** The one setting `PATCH /v1/admin/encryption/rotation` accepts. */
export class SetEncryptionRotationRequestDto {
  @ApiProperty({
    ...ENCRYPTION_KEY_ROTATION_INTERVAL_ENUM,
    nullable: true,
    description:
      'How often the engine rotates the encryption key on its own, or `null` to stop rotating ' +
      "it automatically. Measured from the active key's creation rather than from this request, " +
      "so an interval shorter than that key's current age makes it due at once. Required: " +
      'turning the schedule off is `null`, never an omitted field.',
    example: '1w',
  })
  // `@IsIn` rather than `@IsEnum`: the interval is a literal union with `null` as a meaningful
  // member, and `@IsEnum` has no way to admit `null` as one of the values it accepts.
  @IsIn([...ENCRYPTION_KEY_ROTATION_INTERVALS, null])
  interval!: EncryptionKeyRotationInterval | null;
}
