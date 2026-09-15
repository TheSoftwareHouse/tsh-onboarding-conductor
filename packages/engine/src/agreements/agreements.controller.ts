import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AdminRoute } from '../auth/admin-route.decorator';
import { readOperatorIdentity } from '../auth/azure-jwt.guard';
import { ApiErrorResponses, VALIDATION_ERROR } from '../openapi/api-error-responses.decorator';
import { API_TAGS } from '../openapi/openapi.constants';
import { toPaginatedMeta } from '../pagination';
import { AgreementsService } from './agreements.service';
import {
  ListAgreementsResponseDto,
  PublishAgreementResponseDto,
  toAgreementResponse,
  toPublishAgreementResponse,
} from './dto/agreement.response.dto';
import { ListAgreementsQueryDto } from './dto/list-agreements.query.dto';
import { PublishAgreementRequestDto } from './dto/publish-agreement.request.dto';
import { AgreementTypeMismatchException } from './errors/agreement-type-mismatch.exception';
import { AgreementVersionConflictException } from './errors/agreement-version-conflict.exception';

/** The one property `AzureJwtGuard` adds to the request once a token is accepted. */
type AdminAuthenticatedRequest = Request & { adminTokenClaims?: JWTPayload };

/**
 * Admin surface for agreement versions. Both routes are guarded: publishing is the operator
 * action that puts every onboarding holding an older version out of date, and the listing is the
 * record of what has been published.
 */
@ApiTags(API_TAGS.adminAgreements.name)
@Controller('v1/admin/agreements')
export class AgreementsController {
  constructor(private readonly agreementsService: AgreementsService) {}

  @Post()
  @AdminRoute()
  @ApiOperation({
    operationId: 'publishAgreement',
    summary: 'Publish the next version of an agreement family',
    description:
      'Derives the next version of the family `key` names, `1` for a family nobody has published ' +
      'yet, and links it as pending to every onboarding whose accepted version is now behind, ' +
      "notifying each through its own workflow's notify webhook. `type` belongs to the family, so " +
      'a publish under an existing key with a different type is refused. There is no content and ' +
      'no name: a version is identity and number only.',
  })
  @ApiCreatedResponse({
    type: PublishAgreementResponseDto,
    description: 'The published version and how many onboardings it was linked to.',
  })
  @ApiErrorResponses(
    VALIDATION_ERROR,
    AgreementTypeMismatchException,
    AgreementVersionConflictException,
  )
  async publish(
    @Body() dto: PublishAgreementRequestDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<PublishAgreementResponseDto> {
    const published = await this.agreementsService.publish(
      dto.key,
      dto.type,
      this.resolveOperator(request),
    );

    return toPublishAgreementResponse(published);
  }

  @Get()
  @AdminRoute()
  @ApiOperation({
    operationId: 'listAgreements',
    summary: 'List published agreement versions',
    description:
      'One page of published versions across every family, or one family when `key` narrows it, ' +
      'ordered by key and then newest version first.',
  })
  @ApiOkResponse({
    type: ListAgreementsResponseDto,
    description: 'One page of published versions.',
  })
  @ApiErrorResponses(VALIDATION_ERROR)
  async list(@Query() query: ListAgreementsQueryDto): Promise<ListAgreementsResponseDto> {
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
