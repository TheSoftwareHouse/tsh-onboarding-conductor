import { IsIn, IsOptional } from 'class-validator';

/**
 * `PUT` replaces the stored settings map wholesale, so a body that omits a currently
 * stored key is rejected by default (see `ConnectorSettingsAdminService`'s `validate`).
 * `?replace=true` is the explicit opt-in to drop those keys anyway.
 */
export class ReplaceConnectorSettingsQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  replace?: string;
}
