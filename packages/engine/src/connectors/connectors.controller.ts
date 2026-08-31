import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AzureJwtGuard, readOperatorIdentity } from '../auth/azure-jwt.guard';
import { ConnectorSettingsAdminService } from './connector-settings-admin.service';
import {
  toConnectorSettingsResponse,
  type ConnectorSettingsListResponse,
  type ConnectorSettingsResponse,
} from './dto/connector-settings.response.dto';
import { PatchConnectorSettingsRequestDto } from './dto/patch-connector-settings.request.dto';
import { ReplaceConnectorSettingsQueryDto } from './dto/replace-connector-settings.query.dto';
import { UpdateConnectorSettingsRequestDto } from './dto/update-connector-settings.request.dto';

/** The one property `AzureJwtGuard` adds to the request once a token is accepted. */
type AdminAuthenticatedRequest = Request & { adminTokenClaims?: JWTPayload };

/**
 * Admin surface for operator-provided connector credentials. Guarded like every other admin
 * route: writing a credential is the most sensitive admin operation the engine has, so it must
 * not get a weaker guard than reading a workflow.
 */
@Controller('v1/admin/connectors')
export class ConnectorsController {
  constructor(private readonly connectorSettingsAdminService: ConnectorSettingsAdminService) {}

  @Get()
  @UseGuards(AzureJwtGuard)
  async list(): Promise<ConnectorSettingsListResponse> {
    const views = await this.connectorSettingsAdminService.listSettings();

    return { connectors: views.map(toConnectorSettingsResponse) };
  }

  @Get(':connectorId')
  @UseGuards(AzureJwtGuard)
  async get(@Param('connectorId') connectorId: string): Promise<ConnectorSettingsResponse> {
    const view = await this.connectorSettingsAdminService.findSettings(connectorId);

    return toConnectorSettingsResponse(view);
  }

  @Put(':connectorId')
  @UseGuards(AzureJwtGuard)
  async replace(
    @Param('connectorId') connectorId: string,
    @Body() dto: UpdateConnectorSettingsRequestDto,
    @Query() query: ReplaceConnectorSettingsQueryDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<ConnectorSettingsResponse> {
    const view = await this.connectorSettingsAdminService.replaceSettings(
      connectorId,
      dto.settings,
      this.resolveOperator(request),
      query.replace === 'true',
    );

    return toConnectorSettingsResponse(view);
  }

  @Patch(':connectorId')
  @UseGuards(AzureJwtGuard)
  async patch(
    @Param('connectorId') connectorId: string,
    @Body() dto: PatchConnectorSettingsRequestDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<ConnectorSettingsResponse> {
    const view = await this.connectorSettingsAdminService.mergeSettings(
      connectorId,
      dto.settings,
      this.resolveOperator(request),
    );

    return toConnectorSettingsResponse(view);
  }

  @Delete(':connectorId')
  @HttpCode(204)
  @UseGuards(AzureJwtGuard)
  async remove(
    @Param('connectorId') connectorId: string,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<void> {
    await this.connectorSettingsAdminService.removeSettings(
      connectorId,
      this.resolveOperator(request),
    );
  }

  /**
   * `oid` is Entra's immutable per-directory user id; the UPN is the fallback for a directory
   * that omits it. With `ADMIN_AUTH_ENABLED=false` the guard never runs and sets no claims at
   * all, which is exactly the existing unknown-actor case `readOperatorIdentity` was never meant
   * to answer.
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
