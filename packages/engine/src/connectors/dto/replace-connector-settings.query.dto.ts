import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/**
 * `PUT` replaces the stored settings map wholesale, so a body that omits a currently
 * stored key is rejected by default (see `ConnectorSettingsAdminService`'s `validate`).
 * `?replace=true` is the explicit opt-in to drop those keys anyway.
 */
export class ReplaceConnectorSettingsQueryDto {
  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description:
      'Opt in to dropping every stored key the body omits. Without it, omitting a stored key is ' +
      'refused with `CONNECTOR_SETTINGS_INVALID` (`would_be_dropped`).',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  replace?: string;
}
