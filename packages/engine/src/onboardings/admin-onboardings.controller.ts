import { Controller, Get, Query } from '@nestjs/common';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { OnboardingsService } from './onboardings.service';

@Controller('v1/admin/onboardings')
export class AdminOnboardingsController {
  constructor(private readonly onboardingsService: OnboardingsService) {}

  @Get()
  list(@Query() query: ListAdminOnboardingsQueryDto) {
    return this.onboardingsService.listForAdmin(query);
  }
}
