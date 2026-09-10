import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * `PUT` body: replaces the stored settings map wholesale. Shape only — an object, whitelisted
 * by the global `ValidationPipe` — is enforced here; `ConnectorSettingsService` re-validates
 * every key and value against the adapter's schema, since the key set is dynamic per connector
 * and cannot be expressed as a fixed set of class-validator decorators.
 */
export class UpdateConnectorSettingsRequestDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'The complete settings map. Every required key the adapter declares must be present; a ' +
      'currently stored key the body omits is refused unless `replace=true` is passed.',
    example: { accountSid: 'AC0123456789abcdef', authToken: 'secret', verifyServiceSid: 'VA0123' },
  })
  @IsObject()
  settings!: Record<string, unknown>;
}
