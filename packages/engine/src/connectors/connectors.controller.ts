import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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

  @Get(':connectorType')
  @UseGuards(AzureJwtGuard)
  async get(@Param('connectorType') connectorType: string): Promise<ConnectorSettingsResponse> {
    const view = await this.connectorSettingsAdminService.findSettings(connectorType);

    return toConnectorSettingsResponse(view);
  }

  @Put(':connectorType')
  @UseGuards(AzureJwtGuard)
  async replace(
    @Param('connectorType') connectorType: string,
    @Body() dto: UpdateConnectorSettingsRequestDto,
    @Query() query: ReplaceConnectorSettingsQueryDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<ConnectorSettingsResponse> {
    const view = await this.connectorSettingsAdminService.replaceSettings(
      connectorType,
      dto.settings,
      this.resolveOperator(request),
      query.replace === 'true',
    );

    return toConnectorSettingsResponse(view);
  }

  @Delete(':connectorType')
  @HttpCode(204)
  @UseGuards(AzureJwtGuard)
  async remove(
    @Param('connectorType') connectorType: string,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<void> {
    await this.connectorSettingsAdminService.removeSettings(
      connectorType,
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
