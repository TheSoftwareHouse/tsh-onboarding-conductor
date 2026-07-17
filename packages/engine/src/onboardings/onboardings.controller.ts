import { Body, Controller, Post } from '@nestjs/common';
import { CreateOnboardingDto } from './create-onboarding.dto';
import { OnboardingsService } from './onboardings.service';

@Controller('v1/onboardings')
export class OnboardingsController {
  constructor(private readonly onboardingsService: OnboardingsService) {}

  @Post()
  start(@Body() dto: CreateOnboardingDto) {
    return this.onboardingsService.start(dto);
  }
}
