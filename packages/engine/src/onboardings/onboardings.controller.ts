import {
  Body,
  Controller,
  Param,
  Post,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { AgreementNotFoundException } from '../agreements/errors/agreement-not-found.exception';
import { AgreementNotPublishedException } from '../agreements/errors/agreement-not-published.exception';
import { ApiFailureAuditFilter } from '../audit/api-failure-audit.filter';
import { AdminRoute } from '../auth/admin-route.decorator';
import { resolveOperatorId, type AdminAuthenticatedRequest } from '../auth/azure-jwt.guard';
import { PendingConnectorReconcileUnsupportedException } from '../connectors/errors/pending-connector-reconcile-unsupported.exception';
import { ConnectorNotConfiguredException } from '../connectors/errors/connector-not-configured.exception';
import { SendgridEmailUnavailableException } from '../connectors/errors/sendgrid-email-unavailable.exception';
import { SumsubUnavailableException } from '../connectors/errors/sumsub-unavailable.exception';
import { AlgoanUnavailableException } from '../connectors/errors/algoan-unavailable.exception';
import { VeriffUnavailableException } from '../connectors/errors/veriff-unavailable.exception';
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
import { ExportAdminOnboardingsQueryDto } from './dto/export-admin-onboardings.query.dto';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { ListAdminOnboardingsResponseDto } from './dto/list-admin-onboardings.response.dto';
import { ListOnboardingTransitionsResponseDto } from './dto/list-onboarding-transitions.response.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { CreateOnboardingResponseDto } from './dto/create-onboarding.response.dto';
import { LinkAgreementRequestDto } from './dto/link-agreement.request.dto';
import { ManualReviewResponseDto } from './dto/manual-review.response.dto';
import { ReconcilePendingConnectorResponseDto } from './dto/reconcile-pending-connector.response.dto';
import {
  AcceptAgreementResponseDto,
  LinkAgreementResponseDto,
  OnboardingAgreementsResponseDto,
} from './dto/onboarding-agreements.response.dto';
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
import { OnboardingAwaitingConnectorException } from './errors/onboarding-awaiting-connector.exception';
import { OnboardingNotAwaitingConnectorException } from './errors/onboarding-not-awaiting-connector.exception';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { UnknownWorkflowEvaluationException } from './errors/unknown-workflow-evaluation.exception';
import { EmptyJsonBodyPipe } from './transport/empty-json-body.pipe';
import { DynamicSubmitBodyPipe } from './transport/dynamic-submit-body.pipe';
import { UnsupportedManualReviewActionPipe } from './transport/unsupported-manual-review-action.pipe';
import { DocumentUploadService } from './document-upload.service';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingTransitionsService } from './onboarding-transitions.service';
import { OnboardingsExportService } from './onboardings-export.service';
import { OnboardingsService } from './onboardings.service';
import { PendingConnectorReconcileService } from './pending-connector-reconcile.service';

type ManualReviewAction = 'approve' | 'reject' | 'invalid';

const MANUAL_REVIEW_ACTIONS: readonly ManualReviewAction[] = ['approve', 'reject', 'invalid'];

const OnboardingIdParam = (): MethodDecorator =>
  ApiParam({ name: 'id', format: 'uuid', description: 'The onboarding id.' });

/** Every way the workflow revision an onboarding is pinned to can fail to resolve. */
const WORKFLOW_RESOLUTION_ERRORS = [WorkflowNotFoundException, WorkflowRetiredException] as const;

/**
 * What a connector call made on the submit path can surface: a required credential resolving
 * nowhere, or the provider itself failing in a way the adapter does not map to an outcome. The
 * framework `500` is documented beside the coded ones because an adapter is not obliged to raise
 * an `HttpException`: `WorkflowConnectorExecutorService` re-throws whatever it caught on
 * `propagate`, and the built-in `http_request` and Sumsub adapters raise plain `Error` subclasses.
 */
const CONNECTOR_EXECUTION_ERRORS = [
  ConnectorNotConfiguredException,
  TwilioVerifyUnavailableException,
  SendgridEmailUnavailableException,
  SumsubUnavailableException,
  VeriffUnavailableException,
  AlgoanUnavailableException,
  frameworkError(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'A connector failed in a way its adapter raises as a plain error rather than one of the codes ' +
      'below: an `http_request` call that could not be sent or answered with an unexpected status, ' +
      'a Sumsub level or credential that does not resolve, or a Veriff credential or payload that does ' +
      'not resolve. The framework answers with its own ' +
      'envelope, so there is no `code` to branch on; the connector, the step and the reason are in ' +
      'the audit trail.',
  ),
] as const;

/** `yyyyMMddTHHmmssZ` in UTC, for the export's file name. */
const formatExportTimestamp = (date: Date): string =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

// Tags are declared per route rather than on the controller: this class serves the end customer's
// flow, an operator's manual review and the admin reads, which are three different audiences.
@Controller('v1/onboardings')
export class OnboardingsController {
  private readonly logger = new Logger(OnboardingsController.name);

  constructor(
    private readonly onboardingsService: OnboardingsService,
    private readonly documentUploadService: DocumentUploadService,
    private readonly onboardingStateService: OnboardingStateService,
    private readonly onboardingTransitionsService: OnboardingTransitionsService,
    private readonly pendingConnectorReconcileService: PendingConnectorReconcileService,
    private readonly onboardingsExportService: OnboardingsExportService,
    private readonly apiFailureAuditFilter: ApiFailureAuditFilter,
  ) {}

  @Post()
  @ApiTags(API_TAGS.onboardingFlow.name)
  @ApiOperation({
    operationId: 'startOnboarding',
    summary: 'Start an onboarding',
    description:
      'Creates an onboarding on the latest published revision of the workflow and enters its ' +
      'initial step. The response carries the id every other flow route is keyed by. Every ' +
      "agreement family the workflow declares is linked to it as pending, at that family's " +
      'latest published version; a family with no published version refuses the start.',
  })
  @ApiCreatedResponse({
    type: CreateOnboardingResponseDto,
    description: 'The onboarding exists and sits on its initial step.',
  })
  @ApiErrorResponses(VALIDATION_ERROR, WorkflowNotFoundException, AgreementNotPublishedException)
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
      'rather than dropped. A field an asynchronous connector writes on its callback (a KYC ' +
      'verdict, its attempt count) is refused as `CALLBACK_ONLY`: only the provider decides it.',
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
    {
      exception: OnboardingAwaitingConnectorException,
      args: [{ connectorName: 'kyc', connectorId: 'veriff_kyc', connectorOrder: 1 }],
    },
    UnknownWorkflowEvaluationException,
    ...CONNECTOR_EXECUTION_ERRORS,
    AgreementNotPublishedException,
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

  // Unguarded on purpose, like the handlers above: accepting an agreement is the end user's own
  // action from their own flow, which carries no Entra identity. It is also not gated on the
  // lifecycle status — an approved customer still has to be able to accept new terms.
  @Post(':id/agreements/:agreementId/accept')
  @HttpCode(200)
  @ApiTags(API_TAGS.onboardingFlow.name)
  @ApiOperation({
    operationId: 'acceptOnboardingAgreement',
    summary: 'Accept an agreement version',
    description:
      'Records that the end customer accepted one published version the onboarding already ' +
      'holds, typically the `latestAgreementId` of a family `GET /v1/onboardings/{id}/agreements` ' +
      'reports as `outdated` or `not_accepted`. Idempotent: a repeat reports the original ' +
      '`acceptedAt`, and `200` says nothing is created beyond the recorded acceptance. Not gated ' +
      'on the lifecycle status, so an approved customer can still accept new terms. Only a ' +
      'version the onboarding is already linked to can be accepted, which is what keeps this open ' +
      'route from being a way to attach arbitrary versions to an onboarding.',
  })
  @OnboardingIdParam()
  @ApiParam({
    name: 'agreementId',
    format: 'uuid',
    description: 'The published version to accept.',
  })
  @ApiOkResponse({
    type: AcceptAgreementResponseDto,
    description: 'The acceptance, with when it was first recorded.',
  })
  @ApiErrorResponses(OnboardingNotFoundException, {
    exception: AgreementNotFoundException,
    args: [],
    description:
      'No published version has this id, or the onboarding does not hold it: the pair must ' +
      "already be linked by a start, a submit, a publish or an operator's link.",
  })
  acceptAgreement(
    @Param('id') id: string,
    @Param('agreementId') agreementId: string,
  ): Promise<AcceptAgreementResponseDto> {
    return this.onboardingsService.acceptAgreement(id, agreementId);
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
    description: 'One page of onboarding records, narrowed by the filters. Always paginated.',
  })
  @ApiOkResponse({
    type: ListAdminOnboardingsResponseDto,
    description: 'One page of onboarding records.',
  })
  @ApiErrorResponses(VALIDATION_ERROR)
  list(@Query() query: ListAdminOnboardingsQueryDto): Promise<ListAdminOnboardingsResponseDto> {
    return this.onboardingsService.listForAdmin(query);
  }

  @Get('export')
  @AdminRoute()
  @ApiTags(API_TAGS.adminOnboardings.name)
  @ApiOperation({
    operationId: 'exportOnboardings',
    summary: 'Export onboardings as CSV',
    description:
      'Every onboarding matching the filters, not one page, streamed as RFC 4180 CSV with a UTF-8 ' +
      'BOM. Columns are the summary fields, then one `<Name> score` per score, then one per field as ' +
      'the matching workflows declare them, then `Other data` for any collected key no declared column ' +
      'covers. Headers are labels derived from the keys (`firstName` becomes `First name`). Rows follow the list order. Collected data is decrypted, so the export is audited as ' +
      '`onboardings.exported`. A failure before the first byte answers a 500; one after it aborts the ' +
      'connection instead of ending the file early. Both are audited as `api.request_failed`.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The CSV file: a header row, then one row per matching onboarding.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  @ApiErrorResponses(VALIDATION_ERROR)
  async export(
    @Query() query: ExportAdminOnboardingsQueryDto,
    @Req() request: AdminAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const csv = await this.onboardingsExportService.exportCsv(
      query,
      resolveOperatorId(request.adminTokenClaims),
    );

    response.setHeader('Cache-Control', 'no-store');

    const stream = Readable.from(csv);

    // Nest only unpipes on a disconnect; destroying the stream is what ends the generator.
    response.once('close', () => {
      if (!response.writableFinished) {
        stream.destroy();
      }
    });

    return new StreamableFile(stream, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="onboardings-${formatExportTimestamp(new Date())}.csv"`,
    }).setErrorHandler((error, handlerResponse) => {
      const res = handlerResponse as unknown as Response;
      this.logger.error('Onboardings export stream failed', error.stack);
      this.apiFailureAuditFilter.recordFailure(error, request);

      if (res.destroyed) {
        return;
      }

      if (res.headersSent) {
        res.destroy(error);
        return;
      }

      // The stream headers are already set, so a direct caller would otherwise save this JSON as the CSV.
      res.removeHeader('Content-Disposition');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
    });
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

  @Get(':id/agreements')
  @AdminRoute()
  @ApiTags(API_TAGS.adminOnboardings.name)
  @ApiOperation({
    operationId: 'listOnboardingAgreements',
    summary: "List an onboarding's agreements",
    description:
      'Every agreement family the onboarding holds, as accepted-versus-latest with the status ' +
      'that pairing derives to, ordered by key. An onboarding holding none reads as an empty ' +
      'list, not a 404.',
  })
  @OnboardingIdParam()
  @ApiOkResponse({
    type: OnboardingAgreementsResponseDto,
    description: 'Every family the onboarding holds.',
  })
  @ApiErrorResponses(OnboardingNotFoundException)
  listAgreements(@Param('id') id: string): Promise<OnboardingAgreementsResponseDto> {
    return this.onboardingsService.listAgreements(id);
  }

  // 200 rather than 201: the call is idempotent, so a retry that created nothing must not report
  // a creation. The body says which of the two happened.
  @Post(':id/agreements')
  @AdminRoute()
  @HttpCode(200)
  @ApiTags(API_TAGS.adminOnboardings.name)
  @ApiOperation({
    operationId: 'linkOnboardingAgreement',
    summary: 'Link a published agreement version to an onboarding',
    description:
      'Links one published version to the onboarding as pending, out of band of any step the ' +
      "customer is walking, and notifies the workflow's notify webhook with " +
      '`onboarding.agreement_pending`. Idempotent: a pair already linked reports `created: false` ' +
      'and sends nothing, which is why the response is `200` rather than `201`.',
  })
  @OnboardingIdParam()
  @ApiOkResponse({
    type: LinkAgreementResponseDto,
    description: 'The link, and whether this call created it.',
  })
  @ApiErrorResponses(VALIDATION_ERROR, OnboardingNotFoundException, AgreementNotFoundException)
  linkAgreement(
    @Param('id') id: string,
    @Body() dto: LinkAgreementRequestDto,
  ): Promise<LinkAgreementResponseDto> {
    return this.onboardingsService.linkAgreement(id, dto.agreementId);
  }

  // 200 rather than 201: nothing is created; the body says which of three things happened.
  @Post(':id/pending-connector/reconcile')
  @AdminRoute()
  @HttpCode(200)
  @ApiTags(API_TAGS.adminOnboardings.name)
  @ApiOperation({
    operationId: 'reconcileOnboardingPendingConnector',
    summary: "Read a parked connector's verdict back from its provider",
    description:
      'For an onboarding parked on an asynchronous connector whose callback has not arrived: ' +
      'asks the provider for the verdict it holds and, when there is one, applies it exactly as ' +
      'the callback would have been — same lock, same transition, same client notification. ' +
      '`still_pending` means the provider has not decided and nothing changed; `superseded` ' +
      'means the onboarding left that park between the read and the apply. Every outcome is ' +
      'written to the audit trail under the operator who asked.',
  })
  @OnboardingIdParam()
  @ApiOkResponse({
    type: ReconcilePendingConnectorResponseDto,
    description: 'What the reconcile did, and the onboarding as it now stands.',
  })
  @ApiErrorResponses(
    OnboardingNotFoundException,
    OnboardingNotAwaitingConnectorException,
    PendingConnectorReconcileUnsupportedException,
    ...WORKFLOW_RESOLUTION_ERRORS,
    OnboardingCompletedException,
    InvalidStepDataException,
    UnknownWorkflowEvaluationException,
    AgreementNotPublishedException,
    WebhookDeliveryFailedException,
    ...CONNECTOR_EXECUTION_ERRORS,
  )
  reconcilePendingConnector(
    @Param('id') id: string,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<ReconcilePendingConnectorResponseDto> {
    return this.pendingConnectorReconcileService.reconcile(
      id,
      resolveOperatorId(request.adminTokenClaims),
    );
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
