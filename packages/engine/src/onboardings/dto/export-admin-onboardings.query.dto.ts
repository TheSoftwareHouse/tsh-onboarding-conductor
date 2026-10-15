import { OmitType } from '@nestjs/swagger';
import { ListAdminOnboardingsQueryDto } from './list-admin-onboardings.query.dto';

/** The list's filter criteria without its `page`/`limit` window: an export covers every match. */
export class ExportAdminOnboardingsQueryDto extends OmitType(ListAdminOnboardingsQueryDto, [
  'page',
  'limit',
] as const) {}
