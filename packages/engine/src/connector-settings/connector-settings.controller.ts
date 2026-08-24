import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import {
  AzureJwtGuard,
  readOperatorIdentity,
  type AuthenticatedRequest,
} from '../auth/azure-jwt.guard';
import { ConnectorSettingsService } from './connector-settings.service';
import {
  ConnectorSettingsResponseDto,
  ListConnectorSettingsResponseDto,
} from './dto/connector-settings.response.dto';
import { SaveConnectorSettingsBodyDto } from './dto/save-connector-settings.body.dto';

@Controller('v1/admin/connectors')
@UseGuards(AzureJwtGuard)
export class ConnectorSettingsController {
  constructor(private readonly connectorSettingsService: ConnectorSettingsService) {}

  @Get()
  async list(): Promise<ListConnectorSettingsResponseDto> {
    return this.connectorSettingsService.list();
  }

  @Put(':connectorType')
  async save(
    @Param('connectorType') connectorType: string,
    @Body() body: SaveConnectorSettingsBodyDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConnectorSettingsResponseDto> {
    // Null only where `ADMIN_AUTH_ENABLED=false` admitted the request without an identity; the
    // audit row then records the change as anonymous rather than inventing an operator for it.
    const claims = request.adminTokenClaims;

    return this.connectorSettingsService.save(
      connectorType,
      body.values,
      claims === undefined ? null : readOperatorIdentity(claims),
    );
  }
}
