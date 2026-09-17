import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { API_TAGS } from '../openapi/openapi.constants';
import { HealthResponseDto } from './dto/health.response.dto';

@ApiTags(API_TAGS.health.name)
@Controller('v1/health')
export class HealthController {
  @Get('live')
  @ApiOperation({
    operationId: 'getLiveHealth',
    summary: 'Liveness probe',
    description:
      'Answers as soon as the process serves HTTP. It does not touch the database, Redis or ' +
      'object storage, so it says the engine is up, not that it is ready.',
  })
  @ApiOkResponse({ type: HealthResponseDto, description: 'The process is up.' })
  getLiveHealth(): HealthResponseDto {
    return { status: 'ok' };
  }
}
