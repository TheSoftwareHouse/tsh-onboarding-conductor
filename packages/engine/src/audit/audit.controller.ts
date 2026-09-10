import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { AdminRoute } from '../auth/admin-route.decorator';
import { ApiErrorResponses, VALIDATION_ERROR } from '../openapi/api-error-responses.decorator';
import { API_TAGS } from '../openapi/openapi.constants';
import { AuditService } from './audit.service';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { ListAuditResponseDto } from './dto/list-audit.response.dto';

@ApiTags(API_TAGS.adminAudit.name)
@Controller('v1/admin/audit')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @AdminRoute()
  @ApiOperation({
    operationId: 'listAuditEvents',
    summary: 'List audit events',
    description:
      'One page of the audit log, newest first, narrowed by the filters. A query parameter this ' +
      'route does not declare is refused rather than ignored, so a misspelt filter cannot silently ' +
      'widen the result.',
  })
  @ApiOkResponse({ type: ListAuditResponseDto, description: 'One page of audit events.' })
  @ApiErrorResponses(VALIDATION_ERROR)
  async list(
    @Query(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    query: ListAuditQueryDto,
  ): Promise<ListAuditResponseDto> {
    return this.auditService.list(this.dataSource.manager, query);
  }
}
