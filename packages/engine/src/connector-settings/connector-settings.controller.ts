import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AzureJwtGuard } from '../auth/azure-jwt.guard';
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
  ): Promise<ConnectorSettingsResponseDto> {
    return this.connectorSettingsService.save(connectorType, body.values);
  }
}
