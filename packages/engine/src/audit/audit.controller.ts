import { Controller, Get, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AzureJwtGuard } from '../auth/azure-jwt.guard';
import { AuditService } from './audit.service';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { exceptionFactory } from '../validation/validation-exception.factory';

@Controller('v1/admin/audit')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @UseGuards(AzureJwtGuard)
  async list(
    @Query(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory,
      }),
    )
    query: ListAuditQueryDto,
  ) {
    return this.auditService.list(this.dataSource.manager, query);
  }
}
