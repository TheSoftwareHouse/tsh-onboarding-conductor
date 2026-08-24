import { Body, Controller, Param, Post, Get, HttpCode, Query, UseGuards } from '@nestjs/common';
import { AzureJwtGuard } from '../auth/azure-jwt.guard';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { ReserveDocumentUploadDto } from './dto/reserve-document-upload.dto';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { EmptyJsonBodyPipe } from './transport/empty-json-body.pipe';
import { DynamicSubmitBodyPipe } from './transport/dynamic-submit-body.pipe';
import { UnsupportedManualReviewActionPipe } from './transport/unsupported-manual-review-action.pipe';
import { DocumentUploadService } from './document-upload.service';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingTransitionsService } from './onboarding-transitions.service';
import { OnboardingsService } from './onboardings.service';

type ManualReviewAction = 'approve' | 'reject' | 'invalid';

@Controller('v1/onboardings')
export class OnboardingsController {
  constructor(
    private readonly onboardingsService: OnboardingsService,
    private readonly documentUploadService: DocumentUploadService,
    private readonly onboardingStateService: OnboardingStateService,
    private readonly onboardingTransitionsService: OnboardingTransitionsService,
  ) {}

  @Post()
  start(@Body() dto: CreateOnboardingDto) {
    return this.onboardingsService.start(dto);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Body(new DynamicSubmitBodyPipe()) body: SubmitOnboardingDto) {
    return this.onboardingsService.submit(id, body);
  }

  @Post(':id/documents')
  reserveDocumentUpload(@Param('id') id: string, @Body() dto: ReserveDocumentUploadDto) {
    return this.documentUploadService.reserveDocumentUpload(id, dto);
  }

  @Post(':id/documents/:documentId/complete')
  completeDocumentUpload(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body(new EmptyJsonBodyPipe()) body: Record<string, never>,
  ) {
    void body;
    return this.documentUploadService.completeDocumentUpload(id, documentId);
  }

  @Post(':id/review/:action')
  @HttpCode(200)
  review(@Param(UnsupportedManualReviewActionPipe) params: { id: string; action: string }) {
    const trigger = `manual.${params.action as ManualReviewAction}` as const;

    return this.onboardingsService.manualReview(params.id, trigger);
  }

  @Get(':id/state')
  getState(@Param('id') id: string) {
    return this.onboardingStateService.getState(id);
  }

  // Admin read surface. The POST handlers above and `:id/state` stay public: they serve the end
  // user's own onboarding flow, which has no Entra identity. Everything below is guarded, so the
  // guard is stated per route rather than on the controller.
  @Get('/')
  @UseGuards(AzureJwtGuard)
  list(@Query() query: ListAdminOnboardingsQueryDto) {
    return this.onboardingsService.listForAdmin(query);
  }

  @Get(':id/transitions')
  @UseGuards(AzureJwtGuard)
  listTransitions(@Param('id') id: string) {
    return this.onboardingTransitionsService.listTransitions(id);
  }

  @Get(':id')
  @UseGuards(AzureJwtGuard)
  getForAdmin(@Param('id') id: string) {
    return this.onboardingsService.getForAdmin(id);
  }
}
