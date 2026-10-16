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
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRoute } from '../auth/admin-route.decorator';
import { resolveOperatorId, type AdminAuthenticatedRequest } from '../auth/azure-jwt.guard';
import { ApiErrorResponses, VALIDATION_ERROR } from '../openapi/api-error-responses.decorator';
import { API_TAGS } from '../openapi/openapi.constants';
import { ConnectorSettingsAdminService } from './connector-settings-admin.service';
import {
  ConnectorSettingsListResponseDto,
  ConnectorSettingsResponseDto,
  toConnectorSettingsResponse,
} from './dto/connector-settings.response.dto';
import { PatchConnectorSettingsRequestDto } from './dto/patch-connector-settings.request.dto';
import { ReplaceConnectorSettingsQueryDto } from './dto/replace-connector-settings.query.dto';
import { UpdateConnectorSettingsRequestDto } from './dto/update-connector-settings.request.dto';
import { ConnectorNotFoundException } from './errors/connector-not-found.exception';
import { ConnectorSettingsInvalidException } from './errors/connector-settings-invalid.exception';

const ConnectorIdParam = (): MethodDecorator =>
  ApiParam({
    name: 'connectorId',
    description: "The connector's id, as the list reports it.",
    example: 'twilio_sms_otp',
  });

/**
 * Admin surface for operator-provided connector credentials. Guarded like every other admin
 * route: writing a credential is the most sensitive admin operation the engine has, so it must
 * not get a weaker guard than reading a workflow.
 */
@ApiTags(API_TAGS.adminConnectors.name)
@Controller('v1/admin/connectors')
export class ConnectorsController {
  constructor(private readonly connectorSettingsAdminService: ConnectorSettingsAdminService) {}

  @Get()
  @AdminRoute()
  @ApiOperation({
    operationId: 'listConnectorSettings',
    summary: 'List connector settings',
    description:
      'Every configurable connector with the state of each of its settings. A secret is reported ' +
      'as set or unset; its value is never returned.',
  })
  @ApiOkResponse({
    type: ConnectorSettingsListResponseDto,
    description: 'Every configurable connector.',
  })
  async list(): Promise<ConnectorSettingsListResponseDto> {
    const views = await this.connectorSettingsAdminService.listSettings();

    return { connectors: views.map(toConnectorSettingsResponse) };
  }

  @Get(':connectorId')
  @AdminRoute()
  @ApiOperation({ operationId: 'getConnectorSettings', summary: "Read one connector's settings" })
  @ConnectorIdParam()
  @ApiOkResponse({
    type: ConnectorSettingsResponseDto,
    description: "The connector's settings state.",
  })
  @ApiErrorResponses(ConnectorNotFoundException)
  async get(@Param('connectorId') connectorId: string): Promise<ConnectorSettingsResponseDto> {
    const view = await this.connectorSettingsAdminService.findSettings(connectorId);

    return toConnectorSettingsResponse(view);
  }

  @Put(':connectorId')
  @AdminRoute()
  @ApiOperation({
    operationId: 'replaceConnectorSettings',
    summary: 'Replace connector settings wholesale',
    description:
      'Stores the body as the whole settings map. Because a secret is never read back, a body ' +
      'that omits a currently stored key is refused by default rather than silently dropping it; ' +
      '`replace=true` opts in to dropping it. Every key and value is validated against the ' +
      "adapter's schema. The write is audited under the operator the token identifies.",
  })
  @ConnectorIdParam()
  @ApiOkResponse({
    type: ConnectorSettingsResponseDto,
    description: 'The settings state after the write.',
  })
  @ApiErrorResponses(
    VALIDATION_ERROR,
    ConnectorSettingsInvalidException,
    ConnectorNotFoundException,
  )
  async replace(
    @Param('connectorId') connectorId: string,
    @Body() dto: UpdateConnectorSettingsRequestDto,
    @Query() query: ReplaceConnectorSettingsQueryDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<ConnectorSettingsResponseDto> {
    const view = await this.connectorSettingsAdminService.replaceSettings(
      connectorId,
      dto.settings,
      resolveOperatorId(request.adminTokenClaims),
      query.replace === 'true',
    );

    return toConnectorSettingsResponse(view);
  }

  @Patch(':connectorId')
  @AdminRoute()
  @ApiOperation({
    operationId: 'mergeConnectorSettings',
    summary: 'Merge connector settings',
    description:
      'Changes only the keys the body names: a string overwrites, `null` deletes, an absent key is ' +
      'left as it is. This is how an operator changes one field without resubmitting secrets the ' +
      "API never returns. Every submitted key and value is validated against the adapter's schema. " +
      'The write is audited under the operator the token identifies.',
  })
  @ConnectorIdParam()
  @ApiOkResponse({
    type: ConnectorSettingsResponseDto,
    description: 'The settings state after the write.',
  })
  @ApiErrorResponses(
    VALIDATION_ERROR,
    ConnectorSettingsInvalidException,
    ConnectorNotFoundException,
  )
  async patch(
    @Param('connectorId') connectorId: string,
    @Body() dto: PatchConnectorSettingsRequestDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<ConnectorSettingsResponseDto> {
    const view = await this.connectorSettingsAdminService.mergeSettings(
      connectorId,
      dto.settings,
      resolveOperatorId(request.adminTokenClaims),
    );

    return toConnectorSettingsResponse(view);
  }

  @Delete(':connectorId')
  @HttpCode(204)
  @AdminRoute()
  @ApiOperation({
    operationId: 'removeConnectorSettings',
    summary: 'Clear connector settings',
    description:
      'Removes every stored setting of the connector, so each key reports as unset and the ' +
      'connector is no longer configured. The write is audited under the operator the token ' +
      'identifies.',
  })
  @ConnectorIdParam()
  @ApiNoContentResponse({ description: 'The stored settings are gone.' })
  @ApiErrorResponses(ConnectorNotFoundException)
  async remove(
    @Param('connectorId') connectorId: string,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<void> {
    await this.connectorSettingsAdminService.removeSettings(
      connectorId,
      resolveOperatorId(request.adminTokenClaims),
    );
  }
}
