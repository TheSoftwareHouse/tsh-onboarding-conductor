import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from './audit.service';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';

@Controller('v1/admin/audit')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
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
  ) {
    return this.auditService.list(this.dataSource.manager, query);
  }
}
