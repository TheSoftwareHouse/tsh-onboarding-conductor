import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * `PATCH` body: merges into the stored settings map. A string value overwrites that key; `null`
 * deletes it; an absent key is left untouched. Shape only — an object, whitelisted by the global
 * `ValidationPipe` — is enforced here; `ConnectorSettingsAdminService.mergeSettings` re-validates
 * every submitted key and value against the adapter's schema, since the key set is dynamic per
 * connector and cannot be expressed as a fixed set of class-validator decorators. `null` must
 * survive this DTO unchanged, since it is how a key deletion is expressed.
 */
export class PatchConnectorSettingsRequestDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
    description:
      'The keys to change. A string overwrites that key, `null` deletes it, and a key left out is ' +
      'untouched. Keys the adapter does not declare are refused.',
    example: { accountSid: 'AC0123456789abcdef', authToken: null },
  })
  @IsObject()
  settings!: Record<string, string | null>;
}
