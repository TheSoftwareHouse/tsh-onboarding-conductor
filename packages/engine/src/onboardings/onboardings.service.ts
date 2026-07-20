import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { generateUuidV7 } from '../utils/uuid.util';
import { OnboardingDocumentsRepository } from './onboarding-documents.repository';
import { InvalidDocumentReferenceException } from './errors/invalid-document-reference.exception';
import { OnboardingsRepository } from './onboardings.repository';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';

export interface CreateOnboardingResponse {
  onboardingId: string;
  status: 'awaiting_user' | 'approved';
  currentStep: string | null;
  expiresAt: null;
}

export interface SubmitOnboardingResponse {
  appliedStep: string;
  status: 'awaiting_user' | 'approved';
  currentStep: string | null;
}

export interface AdminOnboardingSummary {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: 'awaiting_user' | 'approved';
  currentStep: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

@Injectable()
export class OnboardingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly onboardingDocumentsRepository: OnboardingDocumentsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
  ) {}

  async start(dto: CreateOnboardingDto): Promise<CreateOnboardingResponse> {
    const workflow = this.workflowRegistryService.getById(dto.workflowId, 1);
    const initialState = workflow.initialize();

    const onboardingId = generateUuidV7();
    await this.dataSource.transaction((manager) =>
      this.onboardingsRepository.createInitial(manager, {
        id: onboardingId,
        workflowId: initialState.workflowId,
        workflowVersion: initialState.workflowVersion,
        status: initialState.status,
        currentStep: initialState.currentStep,
        context: {},
        expiresAt: null,
        completedAt: null,
      }),
    );

    return {
      onboardingId,
      status: initialState.status,
      currentStep: initialState.currentStep,
      expiresAt: null,
    };
  }

  async listForAdmin(query: ListAdminOnboardingsQueryDto): Promise<AdminOnboardingSummary[]> {
    const onboardings = await this.onboardingsRepository.findForAdmin(
      this.dataSource.manager,
      query,
    );

    return onboardings.map((onboarding) => ({
      onboardingId: onboarding.id,
      workflowId: onboarding.workflowId,
      workflowVersion: onboarding.workflowVersion,
      status: onboarding.status as 'awaiting_user' | 'approved',
      currentStep: onboarding.currentStep,
      expiresAt: onboarding.expiresAt,
      createdAt: onboarding.createdAt,
      updatedAt: onboarding.updatedAt,
      completedAt: onboarding.completedAt,
    }));
  }

  async submit(onboardingId: string, submittedData: unknown): Promise<SubmitOnboardingResponse> {
    return this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);

      if (!onboarding) {
        throw new NotFoundException({
          code: 'ONBOARDING_NOT_FOUND',
          message: 'ONBOARDING_NOT_FOUND',
        });
      }

      if (onboarding.status === 'approved' || onboarding.completedAt !== null) {
        throw new ConflictException({
          code: 'ONBOARDING_COMPLETED',
          message: 'ONBOARDING_COMPLETED',
        });
      }

      const workflow = this.workflowRegistryService.getById(
        onboarding.workflowId,
        onboarding.workflowVersion,
      );
      const evaluationResult = await workflow.evaluate({
        currentStep: onboarding.currentStep,
        submittedData,
        onboardingContext: onboarding.context,
      });

      if (!evaluationResult) {
        throw new BadRequestException({
          code: 'INVALID_STEP_DATA',
          message: 'INVALID_STEP_DATA',
        });
      }

      await this.validateSubmittedFileReferences({
        manager,
        onboardingId: onboarding.id,
        currentStep: onboarding.currentStep,
        workflow,
        acceptedData: evaluationResult.acceptedData,
      });

      Object.assign(onboarding, evaluationResult.nextState);

      await this.onboardingsRepository.saveLocked(manager, onboarding);

      return {
        appliedStep: evaluationResult.appliedStep,
        status: evaluationResult.nextState.status,
        currentStep: evaluationResult.nextState.currentStep,
      };
    });
  }

  private async validateSubmittedFileReferences(input: {
    manager: EntityManager;
    onboardingId: string;
    currentStep: string | null;
    workflow: {
      getActiveFileFieldMetadata: (currentStep: string | null | undefined) =>
        | {
            fieldName: string;
            field: {
              type: string;
            };
          }
        | undefined;
    };
    acceptedData: Record<string, unknown>;
  }): Promise<void> {
    if (!input.currentStep) {
      return;
    }

    const activeFileField = input.workflow.getActiveFileFieldMetadata(input.currentStep);
    if (!activeFileField || activeFileField.field.type !== 'file') {
      return;
    }

    const documentId = input.acceptedData[activeFileField.fieldName];
    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new InvalidDocumentReferenceException();
    }

    const reservation = await this.onboardingDocumentsRepository.findByIdForUpdate(
      input.manager,
      documentId,
    );

    if (
      !reservation ||
      reservation.onboardingId !== input.onboardingId ||
      reservation.stepName !== input.currentStep ||
      reservation.fieldName !== activeFileField.fieldName ||
      reservation.status !== 'completed' ||
      !reservation.completedAt ||
      !reservation.finalObjectKey ||
      !reservation.verifiedEtag
    ) {
      throw new InvalidDocumentReferenceException();
    }
  }
}
