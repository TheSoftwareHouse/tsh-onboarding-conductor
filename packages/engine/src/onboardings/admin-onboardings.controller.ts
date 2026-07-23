import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { ManualReviewAction, ManualReviewDto } from './dto/manual-review.dto';
import { OnboardingsService } from './onboardings.service';

@Controller()
export class AdminOnboardingsController {
  constructor(private readonly onboardingsService: OnboardingsService) {}

  @Get('v1/admin/onboardings')
  list(@Query() query: ListAdminOnboardingsQueryDto) {
    return this.onboardingsService.listForAdmin(query);
  }

  @Post('v1/onboardings/:id/review/:action')
  @HttpCode(200)
  review(@Param('id') id: string, @Param() dto: ManualReviewDto) {
    const trigger = `manual.${dto.action as ManualReviewAction}` as const;

    return this.onboardingsService.manualReview(id, trigger);
  }
}
