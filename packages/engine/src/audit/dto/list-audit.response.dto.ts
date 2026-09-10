import { ApiProperty } from '@nestjs/swagger';
import { PaginatedMetaResponseDto } from '../../pagination';
import { AuditEventResponseDto } from './audit-event.response.dto';

export class ListAuditResponseDto {
  @ApiProperty({ type: () => AuditEventResponseDto, isArray: true })
  items!: AuditEventResponseDto[];

  @ApiProperty({ type: () => PaginatedMetaResponseDto })
  meta!: PaginatedMetaResponseDto;
}
