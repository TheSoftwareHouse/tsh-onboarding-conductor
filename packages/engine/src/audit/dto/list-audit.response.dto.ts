import { AuditEventResponseDto } from './audit-event.response.dto';

export class PaginationMetaResponseDto {
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}

export class ListAuditMetaResponseDto {
  pagination!: PaginationMetaResponseDto;
}

export class ListAuditResponseDto {
  items!: AuditEventResponseDto[];
  meta!: ListAuditMetaResponseDto;
}
