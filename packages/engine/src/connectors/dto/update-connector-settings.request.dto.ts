import { IsObject } from 'class-validator';

/**
 * `PUT` body: replaces the stored settings map wholesale. Shape only — an object, whitelisted
 * by the global `ValidationPipe` — is enforced here; `ConnectorSettingsService` re-validates
 * every key and value against the adapter's schema, since the key set is dynamic per connector
 * and cannot be expressed as a fixed set of class-validator decorators.
 */
export class UpdateConnectorSettingsRequestDto {
  @IsObject()
  settings!: Record<string, unknown>;
}
