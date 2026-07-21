import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { DemoOnboardingsService } from './demo-onboardings.service';

@Controller('v1/onboardings')
export class DemoOnboardingsController {
  constructor(private readonly onboardingsService: DemoOnboardingsService) {}

  @Post()
  @HttpCode(200)
  start(@Body() body: Record<string, unknown>) {
    const workflowKey =
      typeof body.workflowKey === 'string' && body.workflowKey.trim() !== ''
        ? body.workflowKey
        : 'base';
    return this.onboardingsService.start({ workflowKey });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.onboardingsService.get(id);
  }

  @Get(':id/state')
  getState(@Param('id') id: string) {
    return this.onboardingsService.getState(id);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.onboardingsService.getHistory(id);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.onboardingsService.submit(id, body);
  }
}
