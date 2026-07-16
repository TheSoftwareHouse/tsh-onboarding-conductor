import { Body, Controller, Param, Post } from '@nestjs/common';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { DynamicSubmitBody } from './transport/dynamic-submit-body.decorator';
import { DynamicSubmitBodyPipe } from './transport/dynamic-submit-body.pipe';
import { OnboardingsService } from './onboardings.service';

@Controller('v1/onboardings')
export class OnboardingsController {
  constructor(private readonly onboardingsService: OnboardingsService) {}

  @Post()
  start(@Body() dto: CreateOnboardingDto) {
    return this.onboardingsService.start(dto);
  }

  @Post(':id/submit')
  submit(
    @Param('id') id: string,
    @DynamicSubmitBody(new DynamicSubmitBodyPipe()) body: SubmitOnboardingDto,
  ) {
    return this.onboardingsService.submit(id, body);
  }
}
