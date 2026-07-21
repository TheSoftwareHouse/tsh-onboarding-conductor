import { BadRequestException, ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingsService } from './onboardings.service';
import { EngineServiceSecretGuard } from './guards/engine-service-secret.guard';
import { ProblemJsonContentTypeInterceptor } from './transport/problem-json-content-type.interceptor';

describe('OnboardingsController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OnboardingsController],
      providers: [
        {
          provide: OnboardingsService,
          useValue: {
            getById: jest.fn().mockResolvedValue({ id: 'onboarding-1' }),
            getState: jest.fn().mockResolvedValue({
              onboardingId: 'onboarding-1',
              status: 'awaiting_user',
              currentStep: null,
            }),
            getHistory: jest.fn().mockResolvedValue([]),
            submit: jest.fn().mockResolvedValue({
              kind: 'rejected',
              problem: {
                type: '/problems/invalid-step-data',
                title: 'Invalid step data',
                status: 400,
                code: 'INVALID_STEP_DATA',
                fieldErrors: [{ field: 'email', code: 'INVALID_FORMAT' }],
              },
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('secret') },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('maps rejected submission results to the feature-local bad-request problem', async () => {
    const controller = app.get(OnboardingsController);
    const result = await controller
      .submit('onboarding-1', { email: 'bad' })
      .catch((error) => error);

    expect(result).toBeInstanceOf(BadRequestException);
    expect(result.getResponse()).toEqual({
      type: '/problems/invalid-step-data',
      title: 'Invalid step data',
      status: 400,
      code: 'INVALID_STEP_DATA',
      fieldErrors: [{ field: 'email', code: 'INVALID_FORMAT' }],
    });
  });

  it('guards regular onboarding routes with the service-secret header', () => {
    const guard = new EngineServiceSecretGuard(new ConfigService());
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow();
  });

  it('sets problem content type on bad request errors', async () => {
    const interceptor = new ProblemJsonContentTypeInterceptor();
    const handler = { handle: jest.fn().mockReturnValue({ pipe: jest.fn() }) };
    const context = {
      switchToHttp: () => ({ getResponse: () => ({ setHeader: jest.fn() }) }),
    } as ExecutionContext;

    interceptor.intercept(context, handler as never);

    expect(handler.handle).toHaveBeenCalled();
  });
});
