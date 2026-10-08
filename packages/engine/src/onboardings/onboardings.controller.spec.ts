import { Readable } from 'node:stream';
import { Logger, StreamableFile, ValidationPipe } from '@nestjs/common';
import { AzureJwtGuard, type AdminAuthenticatedRequest } from '../auth/azure-jwt.guard';
import type { ApiFailureAuditFilter } from '../audit/api-failure-audit.filter';
import { ExportAdminOnboardingsQueryDto } from './dto/export-admin-onboardings.query.dto';
import { OnboardingsExportService } from './onboardings-export.service';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingsService } from './onboardings.service';
import { DocumentUploadService } from './document-upload.service';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingTransitionsService } from './onboarding-transitions.service';
import { PendingConnectorReconcileService } from './pending-connector-reconcile.service';

describe('OnboardingsController', () => {
  it('calls manualReview with the onboarding id and validated trigger from route params', async () => {
    const onboardingsService = {
      manualReview: jest.fn().mockResolvedValue({
        appliedStep: 'awaiting_manual_review',
        status: 'approved',
        currentStep: null,
      }),
    } as unknown as jest.Mocked<Pick<OnboardingsService, 'manualReview'>>;
    const documentUploadService = {} as DocumentUploadService;

    const controller = new OnboardingsController(
      onboardingsService as unknown as OnboardingsService,
      documentUploadService,
      {} as OnboardingStateService,
      {} as OnboardingTransitionsService,
      {} as PendingConnectorReconcileService,
      {} as OnboardingsExportService,
      {} as ApiFailureAuditFilter,
    );

    await expect(controller.review({ id: 'onboarding-id', action: 'approve' })).resolves.toEqual({
      appliedStep: 'awaiting_manual_review',
      status: 'approved',
      currentStep: null,
    });
    expect(onboardingsService.manualReview).toHaveBeenCalledWith('onboarding-id', 'manual.approve');
  });
  it('calls getState with the onboarding id from the route param', async () => {
    const state = {
      onboardingId: 'onboarding-id',
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user' as const,
      currentStep: 'collect_email',
      terminal: false,
      rejectionReason: null,
      step: null,
    };
    const onboardingStateService = {
      getState: jest.fn().mockResolvedValue(state),
    } as unknown as jest.Mocked<Pick<OnboardingStateService, 'getState'>>;

    const controller = new OnboardingsController(
      {} as OnboardingsService,
      {} as DocumentUploadService,
      onboardingStateService as unknown as OnboardingStateService,
      {} as OnboardingTransitionsService,
      {} as PendingConnectorReconcileService,
      {} as OnboardingsExportService,
      {} as ApiFailureAuditFilter,
    );

    await expect(controller.getState('onboarding-id')).resolves.toEqual(state);
    expect(onboardingStateService.getState).toHaveBeenCalledWith('onboarding-id');
  });

  it('reads one onboarding by the id in the route param', async () => {
    const summary = { onboardingId: 'onboarding-id', workflowId: 'base', workflowVersion: 1 };
    const onboardingsService = {
      getForAdmin: jest.fn().mockResolvedValue(summary),
    } as unknown as jest.Mocked<Pick<OnboardingsService, 'getForAdmin'>>;

    const controller = new OnboardingsController(
      onboardingsService as unknown as OnboardingsService,
      {} as DocumentUploadService,
      {} as OnboardingStateService,
      {} as OnboardingTransitionsService,
      {} as PendingConnectorReconcileService,
      {} as OnboardingsExportService,
      {} as ApiFailureAuditFilter,
    );

    await expect(controller.getForAdmin('onboarding-id')).resolves.toBe(summary);
    expect(onboardingsService.getForAdmin).toHaveBeenCalledWith('onboarding-id');
  });

  it('reads the transitions of the onboarding in the route param', async () => {
    const trail = { items: [], meta: { truncated: false } };
    const onboardingTransitionsService = {
      listTransitions: jest.fn().mockResolvedValue(trail),
    } as unknown as jest.Mocked<Pick<OnboardingTransitionsService, 'listTransitions'>>;

    const controller = new OnboardingsController(
      {} as OnboardingsService,
      {} as DocumentUploadService,
      {} as OnboardingStateService,
      onboardingTransitionsService as unknown as OnboardingTransitionsService,
      {} as PendingConnectorReconcileService,
      {} as OnboardingsExportService,
      {} as ApiFailureAuditFilter,
    );

    await expect(controller.listTransitions('onboarding-id')).resolves.toBe(trail);
    expect(onboardingTransitionsService.listTransitions).toHaveBeenCalledWith('onboarding-id');
  });

  it("reconciles the parked connector of the onboarding in the route param as the token's operator", async () => {
    const outcome = { outcome: 'still_pending', onboarding: { onboardingId: 'onboarding-id' } };
    const pendingConnectorReconcileService = {
      reconcile: jest.fn().mockResolvedValue(outcome),
    } as unknown as jest.Mocked<Pick<PendingConnectorReconcileService, 'reconcile'>>;

    const controller = new OnboardingsController(
      {} as OnboardingsService,
      {} as DocumentUploadService,
      {} as OnboardingStateService,
      {} as OnboardingTransitionsService,
      pendingConnectorReconcileService as unknown as PendingConnectorReconcileService,
      {} as OnboardingsExportService,
    );

    await expect(
      controller.reconcilePendingConnector('onboarding-id', {
        adminTokenClaims: { oid: 'operator-oid', preferred_username: 'op@tsh.io' },
      } as never),
    ).resolves.toBe(outcome);
    expect(pendingConnectorReconcileService.reconcile).toHaveBeenCalledWith(
      'onboarding-id',
      'operator-oid',
    );
  });

  describe('the onboarding-scoped agreement routes', () => {
    const createController = (onboardingsService: Partial<OnboardingsService>) =>
      new OnboardingsController(
        onboardingsService as OnboardingsService,
        {} as DocumentUploadService,
        {} as OnboardingStateService,
        {} as OnboardingTransitionsService,
        {} as PendingConnectorReconcileService,
        {} as OnboardingsExportService,
        {} as ApiFailureAuditFilter,
      );

    it('lists the agreements of the onboarding in the route param', async () => {
      const report = { onboardingId: 'onboarding-id', items: [] };
      const listAgreements = jest.fn().mockResolvedValue(report);
      const controller = createController({ listAgreements });

      await expect(controller.listAgreements('onboarding-id')).resolves.toBe(report);
      expect(listAgreements).toHaveBeenCalledWith('onboarding-id');
    });

    it('links the agreement the body names to the onboarding in the route param', async () => {
      const link = {
        onboardingId: 'onboarding-id',
        agreementId: 'agreement-id',
        key: 'eu-b2c-terms',
        version: 2,
        created: true,
      };
      const linkAgreement = jest.fn().mockResolvedValue(link);
      const controller = createController({ linkAgreement });

      await expect(
        controller.linkAgreement('onboarding-id', { agreementId: 'agreement-id' }),
      ).resolves.toBe(link);
      expect(linkAgreement).toHaveBeenCalledWith('onboarding-id', 'agreement-id');
    });

    it('accepts the agreement both route params name', async () => {
      const acceptance = {
        onboardingId: 'onboarding-id',
        agreementId: 'agreement-id',
        key: 'eu-b2c-terms',
        version: 2,
        acceptedAt: '2026-03-01T00:00:00.000Z',
      };
      const acceptAgreement = jest.fn().mockResolvedValue(acceptance);
      const controller = createController({ acceptAgreement });

      await expect(controller.acceptAgreement('onboarding-id', 'agreement-id')).resolves.toBe(
        acceptance,
      );
      expect(acceptAgreement).toHaveBeenCalledWith('onboarding-id', 'agreement-id');
    });

    // The guard placement is the security decision this feature turns on: linking and reading are
    // operator actions, while accepting is the end user's own, from a flow that holds no Entra
    // identity. Read off the metadata rather than trusted to a reviewer's eye.
    it.each([
      ['listAgreements', true],
      ['linkAgreement', true],
      ['acceptAgreement', false],
    ])('guards %s with the admin token: %s', (handler, guarded) => {
      const guards = Reflect.getMetadata(
        '__guards__',
        OnboardingsController.prototype[handler as keyof OnboardingsController],
      );

      expect((guards ?? []).includes(AzureJwtGuard)).toBe(guarded);
    });
  });

  describe('export', () => {
    const request = {
      adminTokenClaims: { oid: 'operator-1' },
    } as unknown as AdminAuthenticatedRequest;

    it('starts the export as the operator, then streams the CSV with its headers', async () => {
      const exportCsv = jest.fn().mockResolvedValue(
        (async function* () {
          yield 'a';
        })(),
      );
      const controller = new OnboardingsController(
        {} as OnboardingsService,
        {} as DocumentUploadService,
        {} as OnboardingStateService,
        {} as OnboardingTransitionsService,
        {} as PendingConnectorReconcileService,
        { exportCsv } as unknown as OnboardingsExportService,
        {} as ApiFailureAuditFilter,
      );
      const setHeader = jest.fn();
      const query = Object.assign(new ExportAdminOnboardingsQueryDto(), { status: 'approved' });

      const file = await controller.export(query, request, {
        setHeader,
        once: jest.fn(),
      } as never);

      expect(exportCsv).toHaveBeenCalledWith(query, 'operator-1');
      expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.getHeaders()).toEqual({
        type: 'text/csv; charset=utf-8',
        disposition: expect.stringMatching(
          /^attachment; filename="onboardings-\d{8}T\d{6}Z\.csv"$/,
        ),
        length: undefined,
      });

      const chunks: string[] = [];
      for await (const chunk of file.getStream() as Readable) {
        chunks.push(chunk as string);
      }

      expect(chunks.join('')).toBe('a');
    });

    describe('when the export stream fails', () => {
      const recordFailure = jest.fn();
      const buildFile = async (stream: () => AsyncGenerator<string>) => {
        const controller = new OnboardingsController(
          {} as OnboardingsService,
          {} as DocumentUploadService,
          {} as OnboardingStateService,
          {} as OnboardingTransitionsService,
          {} as PendingConnectorReconcileService,
          {
            exportCsv: jest.fn().mockImplementation(async () => stream()),
          } as unknown as OnboardingsExportService,
          { recordFailure } as unknown as ApiFailureAuditFilter,
        );
        const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
        const file = await controller.export(new ExportAdminOnboardingsQueryDto(), request, {
          setHeader: jest.fn(),
          once: jest.fn(),
        } as never);
        const failure = new Promise<Error>((resolve) => file.getStream().once('error', resolve));
        file.getStream().resume();

        return { file, failure, loggerError };
      };

      afterEach(() => jest.restoreAllMocks());

      it('destroys the response, without ending it, once headers are sent', async () => {
        const { file, failure, loggerError } = await buildFile(async function* () {
          yield 'a';
          yield 'b';
          throw new Error('db exploded');
        });
        const res = { destroyed: false, headersSent: true, end: jest.fn(), destroy: jest.fn() };

        file.errorHandler(await failure, res as never);

        expect(res.destroy).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'db exploded' }),
        );
        expect(res.end).not.toHaveBeenCalled();
        expect(loggerError).toHaveBeenCalled();
        expect(recordFailure).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'db exploded' }),
          request,
        );
      });

      it('answers a generic 500 without the error text before headers are sent', async () => {
        const { file, failure, loggerError } = await buildFile(async function* () {
          yield* [] as string[];
          throw new Error('relation "onboardings" does not exist');
        });
        const json = jest.fn();
        const status = jest.fn().mockReturnValue({ json });
        const res = {
          destroyed: false,
          headersSent: false,
          status,
          destroy: jest.fn(),
          removeHeader: jest.fn(),
          setHeader: jest.fn(),
        };

        file.errorHandler(await failure, res as never);

        expect(res.removeHeader).toHaveBeenCalledWith('Content-Disposition');
        expect(res.setHeader).toHaveBeenCalledWith(
          'Content-Type',
          'application/json; charset=utf-8',
        );
        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
        expect(JSON.stringify(json.mock.calls)).not.toContain('relation');
        expect(res.destroy).not.toHaveBeenCalled();
        expect(loggerError).toHaveBeenCalled();
        expect(recordFailure).toHaveBeenCalledWith(
          expect.objectContaining({ message: expect.stringContaining('relation') }),
          request,
        );
      });

      it('records the failure even when the response is already destroyed', async () => {
        const { file, failure } = await buildFile(async function* () {
          yield 'a';
          throw new Error('db exploded');
        });
        const res = { destroyed: true, headersSent: true, destroy: jest.fn() };

        file.errorHandler(await failure, res as never);

        expect(recordFailure).toHaveBeenCalledTimes(1);
        expect(res.destroy).not.toHaveBeenCalled();
      });
    });

    describe('when the client closes the connection', () => {
      const buildStream = async (writableFinished: boolean) => {
        const controller = new OnboardingsController(
          {} as OnboardingsService,
          {} as DocumentUploadService,
          {} as OnboardingStateService,
          {} as OnboardingTransitionsService,
          {
            exportCsv: jest.fn().mockResolvedValue(
              (async function* () {
                yield 'a';
              })(),
            ),
          } as unknown as OnboardingsExportService,
          {} as ApiFailureAuditFilter,
        );
        let onClose!: () => void;
        const response = {
          writableFinished,
          setHeader: jest.fn(),
          once: jest.fn((_event: string, listener: () => void) => {
            onClose = listener;
          }),
        };
        const file = await controller.export(
          new ExportAdminOnboardingsQueryDto(),
          request,
          response as never,
        );

        return { stream: file.getStream() as Readable, close: () => onClose(), response };
      };

      it('destroys the stream when the response did not finish', async () => {
        const { stream, close, response } = await buildStream(false);

        close();

        expect(response.once).toHaveBeenCalledWith('close', expect.any(Function));
        expect(stream.destroyed).toBe(true);
      });

      it('leaves the stream alone when the response had finished', async () => {
        const { stream, close } = await buildStream(true);

        close();

        expect(stream.destroyed).toBe(false);
      });
    });

    it('does not accept page or limit: the whitelist strips them from the query', async () => {
      const pipe = new ValidationPipe({ whitelist: true, transform: true });
      const query = (await pipe.transform(
        { status: 'approved', page: '2', limit: '5' },
        { type: 'query', metatype: ExportAdminOnboardingsQueryDto },
      )) as ExportAdminOnboardingsQueryDto;

      expect(query).toEqual({ status: 'approved' });
    });

    it('keeps the numeric transform on workflowVersion', async () => {
      const pipe = new ValidationPipe({ whitelist: true, transform: true });
      const query = (await pipe.transform(
        { workflowVersion: '3' },
        { type: 'query', metatype: ExportAdminOnboardingsQueryDto },
      )) as ExportAdminOnboardingsQueryDto;

      expect(query.workflowVersion).toBe(3);
    });
  });
});
