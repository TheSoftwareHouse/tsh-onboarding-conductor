import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AzureJwtGuard, readOperatorIdentity } from '../auth/azure-jwt.guard';
import { toPaginatedMeta } from '../pagination';
import { AgreementsService } from './agreements.service';
import {
  toAgreementResponse,
  toPublishAgreementResponse,
  type ListAgreementsResponse,
  type PublishAgreementResponse,
} from './dto/agreement.response.dto';
import { ListAgreementsQueryDto } from './dto/list-agreements.query.dto';
import { PublishAgreementRequestDto } from './dto/publish-agreement.request.dto';

/** The one property `AzureJwtGuard` adds to the request once a token is accepted. */
type AdminAuthenticatedRequest = Request & { adminTokenClaims?: JWTPayload };

/**
 * Admin surface for agreement versions. Both routes are guarded: publishing is the operator
 * action that puts every onboarding holding an older version out of date, and the listing is the
 * record of what has been published.
 */
@Controller('v1/admin/agreements')
export class AgreementsController {
  constructor(private readonly agreementsService: AgreementsService) {}

  @Post()
  @UseGuards(AzureJwtGuard)
  async publish(
    @Body() dto: PublishAgreementRequestDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<PublishAgreementResponse> {
    const published = await this.agreementsService.publish(
      dto.key,
      dto.type,
      this.resolveOperator(request),
    );

    return toPublishAgreementResponse(published);
  }

  @Get()
  @UseGuards(AzureJwtGuard)
  async list(@Query() query: ListAgreementsQueryDto): Promise<ListAgreementsResponse> {
    const result = await this.agreementsService.list(query);

    return {
      items: result.items.map(toAgreementResponse),
      meta: toPaginatedMeta(result),
    };
  }

  /**
   * `oid` is Entra's immutable per-directory user id; the UPN is the fallback for a directory
   * that omits it. With `ADMIN_AUTH_ENABLED=false` the guard never runs and sets no claims at
   * all, which is the unknown-actor case the audit row records rather than attributing the
   * publish to nobody.
   */
  private resolveOperator(request: AdminAuthenticatedRequest): string {
    const { adminTokenClaims } = request;

    if (adminTokenClaims === undefined) {
      return ADMIN_ACCESS_UNKNOWN_ACTOR;
    }

    const operator = readOperatorIdentity(adminTokenClaims);

    return operator.objectId ?? operator.userPrincipalName ?? ADMIN_ACCESS_UNKNOWN_ACTOR;
  }
}
