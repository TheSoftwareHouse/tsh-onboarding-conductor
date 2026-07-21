import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { DynamicSubmitBodyPipe } from './transport/dynamic-submit-body.pipe';
import { OnboardingsService } from './onboardings.service';
import { EngineServiceSecretGuard } from './guards/engine-service-secret.guard';
import { ProblemJsonContentTypeInterceptor } from './transport/problem-json-content-type.interceptor';
import { InvalidStepDataProblemException } from './errors/invalid-step-data.problem.exception';
import { OnboardingIdParamPipe } from './transport/onboarding-id-param.pipe';

@Controller('v1/onboardings')
@UseGuards(EngineServiceSecretGuard)
export class OnboardingsController {
  constructor(private readonly onboardingsService: OnboardingsService) {}

  @Post()
  start(@Body() dto: CreateOnboardingDto) {
    return this.onboardingsService.start(dto);
  }

  @Get(':id')
  getById(@Param('id', OnboardingIdParamPipe) id: string) {
    return this.onboardingsService.getById(id);
  }

  @Get(':id/state')
  getState(@Param('id', OnboardingIdParamPipe) id: string) {
    return this.onboardingsService.getState(id);
  }

  @Get(':id/history')
  getHistory(@Param('id', OnboardingIdParamPipe) id: string) {
    return this.onboardingsService.getHistory(id);
  }

  @Post(':id/submit')
  @UseInterceptors(ProblemJsonContentTypeInterceptor)
  async submit(
    @Param('id', OnboardingIdParamPipe) id: string,
    @Body(new DynamicSubmitBodyPipe()) body: SubmitOnboardingDto,
  ) {
    const result = await this.onboardingsService.submit(id, body);

    if (result.kind === 'rejected') {
      throw new InvalidStepDataProblemException(result.problem);
    }

    return result;
  }
}
