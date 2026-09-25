import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** The one setting `PATCH /v1/admin/encryption` accepts. */
export class SetEncryptionEnabledRequestDto {
  @ApiProperty({
    description:
      '`true` turns encryption on — creating a first key if none is active — and encrypts every ' +
      'stored onboarding in the background; `false` turns it off, retires the active key, and ' +
      'decrypts every stored onboarding back to plain JSON in the background. Asking for the ' +
      'state that already holds changes nothing.',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;
}
