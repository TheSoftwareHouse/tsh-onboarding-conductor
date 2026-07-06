import { Controller, Get } from '@nestjs/common';

@Controller('v1/health')
export class HealthController {
  @Get('live')
  getLiveHealth() {
    return { status: 'ok' };
  }
}
