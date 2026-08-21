import { IsObject } from 'class-validator';

/**
 * Only the fields the operator edited. A key present with an empty value clears the stored
 * setting, which is how a connector is handed back to its environment default; a key that is
 * absent is left exactly as it is, so a form need not re-submit a secret to save its neighbour.
 *
 * The values themselves are checked against the connector's declared fields in the service,
 * where the declaration that says which keys exist and which are secret already lives.
 */
export class SaveConnectorSettingsBodyDto {
  @IsObject()
  values!: Record<string, unknown>;
}
