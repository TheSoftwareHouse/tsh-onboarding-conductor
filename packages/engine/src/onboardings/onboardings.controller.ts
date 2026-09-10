import { Body, Controller, Param, Post, Get, HttpCode, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRoute } from '../auth/admin-route.decorator';
import { ConnectorNotConfiguredException } from '../connectors/errors/connector-not-configured.exception';
import { SendgridEmailUnavailableException } from '../connectors/errors/sendgrid-email-unavailable.exception';
import { SumsubUnavailableException } from '../connectors/errors/sumsub-unavailable.exception';
import { TwilioVerifyUnavailableException } from '../connectors/errors/twilio-verify-unavailable.exception';
import {
  ApiErrorResponses,
  VALIDATION_ERROR,
  frameworkError,
} from '../openapi/api-error-responses.decorator';
import { API_TAGS } from '../openapi/openapi.constants';
import { WebhookDeliveryFailedException } from '../webhook/errors/webhook-delivery-failed.exception';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import { WorkflowRetiredException } from '../workflows/errors/workflow-retired.exception';
import { AdminOnboardingSummaryResponseDto } from './dto/admin-onboarding-summary.response.dto';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { ListAdminOnboardingsResponseDto } from './dto/list-admin-onboardings.response.dto';
import { ListOnboardingTransitionsResponseDto } from './dto/list-onboarding-transitions.response.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { CreateOnboardingResponseDto } from './dto/create-onboarding.response.dto';
import { ManualReviewResponseDto } from './dto/manual-review.response.dto';
import { OnboardingStateResponseDto } from './dto/onboarding-state.response.dto';
import { ReserveDocumentUploadDto } from './dto/reserve-document-upload.dto';
import {
  CompleteDocumentUploadResponseDto,
  ReserveDocumentUploadResponseDto,
} from './dto/reserve-document-upload.response.dto';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { SubmitOnboardingResponseDto } from './dto/submit-onboarding.response.dto';
import { DocumentUploadConflictException } from './errors/document-upload-conflict.exception';
import { DocumentUploadExpiredException } from './errors/document-upload-expired.exception';
import { DocumentUploadNotFoundException } from './errors/document-upload-not-found.exception';
import { InvalidDocumentUploadException } from './errors/invalid-document-upload.exception';
import { InvalidStepDataException } from './errors/invalid-step-data.exception';
import { ManualTransitionNotAvailableException } from './errors/manual-transition-not-available.exception';
import { OnboardingCompletedException } from './errors/onboarding-completed.exception';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { UnknownWorkflowEvaluationException } from './errors/unknown-workflow-evaluation.exception';
import { EmptyJsonBodyPipe } from './transport/empty-json-body.pipe';
import { DynamicSubmitBodyPipe } from './transport/dynamic-submit-body.pipe';
import { UnsupportedManualReviewActionPipe } from './transport/unsupported-manual-review-action.pipe';
import { DocumentUploadService } from './document-upload.service';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingTransitionsService } from './onboarding-transitions.service';
import { OnboardingsService } from './onboardings.service';

type ManualReviewAction = 'approve' | 'reject' | 'invalid';

const MANUAL_REVIEW_ACTIONS: readonly ManualReviewAction[] = ['approve', 'reject', 'invalid'];

const OnboardingIdParam = (): MethodDecorator =>
  ApiParam({ name: 'id', format: 'uuid', description: 'The onboarding id.' });

/** Every way the workflow revision an onboarding is pinned to can fail to resolve. */
const WORKFLOW_RESOLUTION_ERRORS = [WorkflowNotFoundException, WorkflowRetiredException] as const;

/**
 * What a connector call made on the submit path can surface: a required credential resolving
 * nowhere, or the provider itself failing in a way the adapter does not map to an outcome.
 */
const CONNECTOR_EXECUTION_ERRORS = [
  ConnectorNotConfiguredException,
  TwilioVerifyUnavailableException,
  SendgridEmailUnavailableException,
  SumsubUnavailableException,
] as const;

// Tags are declared per route rather than on the controller: this class serves the end customer's
// flow, an operator's manual review and the admin reads, which are three different audiences.
@Controller('v1/onboardings')
export class OnboardingsController {
  constructor(
    private readonly onboardingsService: OnboardingsService,
    private readonly documentUploadService: DocumentUploadService,
    private readonly onboardingStateService: OnboardingStateService,
    private readonly onboardingTransitionsService: OnboardingTransitionsService,
  ) {}

  @Post()
  @ApiTags(API_TAGS.onboardingFlow.name)
  @ApiOperation({
    operationId: 'startOnboarding',
    summary: 'Start an onboarding',
    description:
      'Creates an onboarding on the latest published revision of the workflow and enters its ' +
      'initial step. The response carries the id every other flow route is keyed by.',
  })
  @ApiCreatedResponse({
    type: CreateOnboardingResponseDto,
    description: 'The onboarding exists and sits on its initial step.',
  })
  @ApiErrorResponses(VALIDATION_ERROR, WorkflowNotFoundException)
  start(@Body() dto: CreateOnboardingDto): Promise<CreateOnboardingResponseDto> {
    return this.onboardingsService.start(dto);
  }

  @Post(':id/submit')
  @ApiTags(API_TAGS.onboardingFlow.name)
  @ApiOperation({
    operationId: 'submitOnboardingStep',
    summary: 'Submit the current step',
    description:
      "Validates the body against the current step, runs the step's connectors, applies the " +
      'transition the outcome selects and reports where the onboarding now stands. A refused body ' +
      'leaves the onboarding exactly where it was. `201` is the framework default for `POST`; ' +
      'nothing is created beyond the recorded move.',
  })
  @OnboardingIdParam()
  @ApiBody({
    description:
      "The current step's data: exactly the fields `GET /v1/onboardings/{id}/state` lists as " +
      'active, validated against its `step.schema`. There is no fixed shape; the workflow decides, ' +
      'so the body is passed to the step validator untouched and an unknown field is refused ' +
      'rather than dropped.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiCreatedResponse({
    type: SubmitOnboardingResponseDto,
    description: 'Where the onboarding stands after the move.',
  })
  @ApiErrorResponses(
    InvalidStepDataException,
    OnboardingNotFoundException,
    ...WORKFLOW_RESOLUTION_ERRORS,
    OnboardingCompletedException,
    UnknownWorkflowEvaluationException,
    ...CONNECTOR_EXECUTION_ERRORS,
    WebhookDeliveryFailedException,
  )
  submit(
    @Param('id') id: string,
    @Body(new DynamicSubmitBodyPipe()) body: SubmitOnboardingDto,
  ): Promise<SubmitOnboardingResponseDto> {
    return this.onboardingsService.submit(id, body);
  }

  @Post(':id/documents')
  @ApiTags(API_TAGS.onboardingFlow.name)
  @ApiOperation({
    operationId: 'reserveDocumentUpload',
    summary: 'Reserve a document upload',
    description:
      "Declares a file for one of the current step's upload fields and returns a presigned " +
      'target to send the bytes to. The reservation expires; complete it before `expiresAt`. ' +
      'Reserving again for a field whose reservation is still pending is refused.',
  })
  @OnboardingIdParam()
  @ApiCreatedResponse({
    type: ReserveDocumentUploadResponseDto,
    description: 'The reservation and the presigned target to send the bytes to.',
  })
  @ApiErrorResponses(
    VALIDATION_ERROR,
    InvalidDocumentUploadException,
    DocumentUploadNotFoundException,
    ...WORKFLOW_RESOLUTION_ERRORS,
    DocumentUploadConflictException,
  )
  reserveDocumentUpload(
    @Param('id') id: string,
    @Body() dto: ReserveDocumentUploadDto,
  ): Promise<ReserveDocumentUploadResponseDto> {
    return this.documentUploadService.reserveDocumentUpload(id, dto);
  }

  @Post(':id/documents/:documentId/complete')
  @ApiTags(API_TAGS.onboardingFlow.name)
  @ApiOperation({
    operationId: 'completeDocumentUpload',
    summary: 'Complete a document upload',
    description:
      'Tells the engine the bytes are in place. It reads the object back, checks the content ' +
      "type, size and image dimensions against the field's limits, and attaches the document to " +
      'the onboarding so the step can be submitted.',
  })
  @OnboardingIdParam()
  @ApiParam({
    name: 'documentId',
    format: 'uuid',
    description: 'The reservation to complete, as the reserve route returned it.',
  })
  @ApiBody({
    required: false,
    description: 'No body, or an empty JSON object. Anything else is refused.',
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  @ApiCreatedResponse({
    type: CompleteDocumentUploadResponseDto,
    description: 'The document is verified and attached to the onboarding.',
  })
  @ApiErrorResponses(
    InvalidDocumentUploadException,
    DocumentUploadNotFoundException,
    ...WORKFLOW_RESOLUTION_ERRORS,
    DocumentUploadExpiredException,
  )
  completeDocumentUpload(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body(new EmptyJsonBodyPipe()) body: Record<string, never>,
  ): Promise<CompleteDocumentUploadResponseDto> {
    void body;
    return this.documentUploadService.completeDocumentUpload(id, documentId);
  }

  @Post(':id/review/:action')
  @HttpCode(200)
  @ApiTags(API_TAGS.manualReview.name)
  @ApiOperation({
    operationId: 'reviewOnboarding',
    summary: 'Record a manual review decision',
    description:
      'Applies the `manual.<action>` transition the current step declares and reports where the ' +
      'onboarding now stands. Unauthenticated today: unlike the admin routes it is not behind the ' +
      'operator bearer guard, which is a known gap and not a design intent.',
  })
  @OnboardingIdParam()
  @ApiParam({
    name: 'action',
    enum: [...MANUAL_REVIEW_ACTIONS],
    description: 'The decision. Anything else is refused before the onboarding is looked up.',
  })
  @ApiOkResponse({
    type: ManualReviewResponseDto,
    description: 'Where the onboarding stands after the decision.',
  })
  @ApiErrorResponses(
    frameworkError(400, '`action` is not one of `approve`, `reject`, `invalid`.'),
    OnboardingNotFoundException,
    ...WORKFLOW_RESOLUTION_ERRORS,
    OnboardingCompletedException,
    ManualTransitionNotAvailableException,
    UnknownWorkflowEvaluationException,
    WebhookDeliveryFailedException,
  )
  review(
    @Param(UnsupportedManualReviewActionPipe) params: { id: string; action: string },
  ): Promise<ManualReviewResponseDto> {
    const trigger = `manual.${params.action as ManualReviewAction}` as const;

    return this.onboardingsService.manualReview(params.id, trigger);
  }

  @Get(':id/state')
  @ApiTags(API_TAGS.onboardingFlow.name)
  @ApiOperation({
    operationId: 'getOnboardingState',
    summary: 'Read the current step',
    description:
      'Where the onboarding stands and, unless it is terminal, the step to render: its fields, ' +
      'which of them apply given the data so far, their persisted values for prefill, and the ' +
      'JSON Schema the next submit will be checked against.',
  })
  @OnboardingIdParam()
  @ApiOkResponse({
    type: OnboardingStateResponseDto,
    description: 'The current state and, unless terminal, the step to render.',
  })
  @ApiErrorResponses(OnboardingNotFoundException, ...WORKFLOW_RESOLUTION_ERRORS)
  getState(@Param('id') id: string): Promise<OnboardingStateResponseDto> {
    return this.onboardingStateService.getState(id);
  }

  // Admin read surface. The POST handlers above and `:id/state` stay public: they serve the end
  // user's own onboarding flow, which has no Entra identity. Everything below is guarded, so the
  // guard is stated per route rather than on the controller.
  @Get('/')
  @AdminRoute()
  @ApiTags(API_TAGS.adminOnboardings.name)
  @ApiOperation({
    operationId: 'listOnboardings',
    summary: 'List onboardings',
    description:
      'One page of onboarding records, narrowed by the filters. Always paginated, so an operator ' +
      'can never pull the whole table in one request.',
  })
  @ApiOkResponse({
    type: ListAdminOnboardingsResponseDto,
    description: 'One page of onboarding records.',
  })
  @ApiErrorResponses(VALIDATION_ERROR)
  list(@Query() query: ListAdminOnboardingsQueryDto): Promise<ListAdminOnboardingsResponseDto> {
    return this.onboardingsService.listForAdmin(query);
  }

  @Get(':id/transitions')
  @AdminRoute()
  @ApiTags(API_TAGS.adminOnboardings.name)
  @ApiOperation({
    operationId: 'listOnboardingTransitions',
    summary: 'List the states an onboarding moved through',
    description:
      'The chain of moves, oldest first, as the audit trail recorded them. Not paginated: a ' +
      'reader wants the journey, and `meta.truncated` says when it is reported from the middle.',
  })
  @OnboardingIdParam()
  @ApiOkResponse({
    type: ListOnboardingTransitionsResponseDto,
    description: 'The chain of moves, oldest first.',
  })
  @ApiErrorResponses(OnboardingNotFoundException)
  listTransitions(@Param('id') id: string): Promise<ListOnboardingTransitionsResponseDto> {
    return this.onboardingTransitionsService.listTransitions(id);
  }

  @Get(':id')
  @AdminRoute()
  @ApiTags(API_TAGS.adminOnboardings.name)
  @ApiOperation({
    operationId: 'getOnboarding',
    summary: 'Read an onboarding record',
    description: 'One onboarding as the list reports it, without its collected data.',
  })
  @OnboardingIdParam()
  @ApiOkResponse({
    type: AdminOnboardingSummaryResponseDto,
    description: 'The onboarding record.',
  })
  @ApiErrorResponses(OnboardingNotFoundException)
  getForAdmin(@Param('id') id: string): Promise<AdminOnboardingSummaryResponseDto> {
    return this.onboardingsService.getForAdmin(id);
  }
}
