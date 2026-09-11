import {
  BadRequestException,
  Logger,
  NotFoundException,
  type ArgumentsHost,
  type HttpServer,
} from '@nestjs/common';
import { BaseExceptionFilter, type HttpAdapterHost } from '@nestjs/core';
import type { JWTPayload } from 'jose';
import type { DataSource } from 'typeorm';
import { markAuditRecorded } from './audit-recorded.marker';
import type { AuditService } from './audit.service';
import { ADMIN_ACCESS_UNKNOWN_ACTOR, type ApiFailureAuditInput } from './audit.types';
import {
  ApiFailureAuditFilter,
  API_FAILURE_MAX_FIELD_ERRORS,
  API_FAILURE_MAX_FIELD_ERROR_REASONS,
  API_FAILURE_MAX_ROUTE_PARAMS,
  API_FAILURE_METADATA_STRING_MAX_LENGTH,
  MAX_PENDING_API_FAILURE_AUDITS,
} from './api-failure-audit.filter';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

type TestRequest = {
  method?: string;
  path?: string;
  url?: string;
  originalUrl?: string;
  route?: { path?: string };
  params?: Record<string, string>;
  adminTokenClaims?: JWTPayload;
};

/**
 * `isApiRequest` (the scoping this filter reuses) reads `originalUrl`/`url`, not `path` - a real
 * Express request always carries `url`, so every test request must too, or every case would look
 * like it fell outside `/v1` regardless of what it is actually exercising.
 */
const buildRequest = (overrides: TestRequest & { path: string }): TestRequest => ({
  url: overrides.path,
  ...overrides,
});

type TestHttpAdapter = {
  reply: jest.Mock;
  isHeadersSent: jest.Mock;
  end: jest.Mock;
};

const createHttpAdapter = (): TestHttpAdapter => ({
  reply: jest.fn(),
  isHeadersSent: jest.fn().mockReturnValue(false),
  end: jest.fn(),
});

const createHost = (request: TestRequest, response: unknown = {}): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
      getResponse: <T>() => response as T,
      getNext: () => undefined,
    }),
    getArgByIndex: (index: number) => (index === 0 ? request : response),
    getArgs: () => [request, response],
    getType: () => 'http',
  }) as unknown as ArgumentsHost;

const createAuditServiceMock = (): AuditService & { logApiFailure: jest.Mock } =>
  ({
    logApiFailure: jest.fn().mockResolvedValue(undefined),
  }) as unknown as AuditService & { logApiFailure: jest.Mock };

const createFilter = (
  auditService: AuditService,
  httpAdapter: TestHttpAdapter = createHttpAdapter(),
): ApiFailureAuditFilter =>
  new ApiFailureAuditFilter(
    { httpAdapter } as unknown as HttpAdapterHost,
    auditService,
    {} as DataSource,
  );

const notFoundRequest = (): TestRequest =>
  buildRequest({
    method: 'GET',
    path: '/v1/onboardings/abc',
    route: { path: '/v1/onboardings/:id' },
  });

describe('ApiFailureAuditFilter', () => {
  describe('response fidelity', () => {
    it.each<[string, unknown]>([
      [
        '4xx',
        new NotFoundException({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' }),
      ],
      ['5xx', new Error('boom')],
    ])(
      'produces a byte-identical response to BaseExceptionFilter alone for a %s',
      (_label, exception) => {
        const host = createHost(notFoundRequest());

        const baselineAdapter = createHttpAdapter();
        new BaseExceptionFilter(baselineAdapter as unknown as HttpServer).catch(exception, host);

        const filterAdapter = createHttpAdapter();
        const filter = createFilter(createAuditServiceMock(), filterAdapter);
        filter.catch(exception, host);

        expect(filterAdapter.reply.mock.calls).toEqual(baselineAdapter.reply.mock.calls);
        expect(filterAdapter.end.mock.calls).toEqual(baselineAdapter.end.mock.calls);
      },
    );
  });

  describe('suppression', () => {
    it('writes no row for an exception already marked, and writes one for the same exception unmarked', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);

      const recorded = markAuditRecorded(
        new BadRequestException({ code: 'ALREADY_AUDITED', message: 'ALREADY_AUDITED' }),
      );
      filter.catch(recorded, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();
      expect(auditService.logApiFailure).not.toHaveBeenCalled();

      const unmarked = new BadRequestException({
        code: 'ALREADY_AUDITED',
        message: 'ALREADY_AUDITED',
      });
      filter.catch(unmarked, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();
      expect(auditService.logApiFailure).toHaveBeenCalledTimes(1);
    });
  });

  describe('/v1 scoping', () => {
    it('writes no row for a request outside /v1', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);

      filter.catch(new Error('boom'), createHost(buildRequest({ method: 'GET', path: '/health' })));
      await filter.flushApiFailureAudits();

      expect(auditService.logApiFailure).not.toHaveBeenCalled();
    });
  });

  describe('write failure', () => {
    it('swallows a logApiFailure rejection: the response is still produced and logger.error is called', async () => {
      const auditService = createAuditServiceMock();
      auditService.logApiFailure.mockRejectedValue(new Error('db down'));
      const httpAdapter = createHttpAdapter();
      const filter = createFilter(auditService, httpAdapter);
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      filter.catch(
        new NotFoundException({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' }),
        createHost(notFoundRequest()),
      );

      expect(httpAdapter.reply).toHaveBeenCalledTimes(1);

      await filter.flushApiFailureAudits();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record API failure audit'),
      );

      loggerErrorSpy.mockRestore();
    });
  });

  describe('write-amplification bound', () => {
    it('drops a scheduled write once the in-flight cap is reached rather than queueing it', async () => {
      const stuckWrite = createDeferred<unknown>();
      const auditService = createAuditServiceMock();
      auditService.logApiFailure.mockReturnValue(stuckWrite.promise);
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const filter = createFilter(auditService);

      for (let submitted = 0; submitted <= MAX_PENDING_API_FAILURE_AUDITS; submitted += 1) {
        filter.catch(
          new NotFoundException({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' }),
          createHost(
            buildRequest({
              method: 'GET',
              path: `/v1/onboardings/${submitted}`,
              route: { path: '/v1/onboardings/:id' },
            }),
          ),
        );
      }

      expect(auditService.logApiFailure).toHaveBeenCalledTimes(MAX_PENDING_API_FAILURE_AUDITS);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('writes are already in flight'),
      );

      stuckWrite.resolve(undefined);
      await filter.flushApiFailureAudits();
      loggerErrorSpy.mockRestore();
    });
  });

  describe('action selection', () => {
    it.each<[number, string, unknown]>([
      [404, 'api.request_rejected', new NotFoundException({ code: 'X', message: 'X' })],
      [500, 'api.request_failed', new Error('boom')],
    ])('records status %s as %s', async (status, action, exception) => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.action).toBe(action);
      expect(input.metadata.status).toBe(status);
    });
  });

  describe('resourceId and route', () => {
    it('files the row under the matched route template, not the concrete path', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);

      filter.catch(
        new NotFoundException({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' }),
        createHost(
          buildRequest({
            method: 'GET',
            path: '/v1/onboardings/real-id-123',
            route: { path: '/v1/onboardings/:id' },
            params: { id: 'real-id-123' },
          }),
        ),
      );
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.resourceId).toBe('GET /v1/onboardings/:id');
      expect(input.metadata.route).toBe('/v1/onboardings/:id');
      expect(input.metadata.routeParams).toEqual({ id: 'real-id-123' });
    });

    it('falls back to the raw path when Nest matched no route', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);

      filter.catch(
        new Error('boom'),
        createHost(buildRequest({ method: 'GET', path: '/v1/unknown/path' })),
      );
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.resourceId).toBe('/v1/unknown/path');
      expect(input.metadata.route).toBe('/v1/unknown/path');
      expect(input.metadata.routeParams).toBeUndefined();
    });
  });

  describe('actor attribution', () => {
    it('attributes an anonymous actor when the request carries no verified claims', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);

      filter.catch(
        new NotFoundException({ code: 'X', message: 'X' }),
        createHost(notFoundRequest()),
      );
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.actorType).toBe('anonymous');
      expect(input.actorId).toBe(ADMIN_ACCESS_UNKNOWN_ACTOR);
    });

    it('attributes the operator identity when the request carries verified admin claims', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);

      filter.catch(
        new NotFoundException({ code: 'X', message: 'X' }),
        createHost(
          buildRequest({
            method: 'DELETE',
            path: '/v1/admin/connectors/mock_kyc',
            route: { path: '/v1/admin/connectors/:connectorId' },
            adminTokenClaims: { oid: 'operator-1' } as JWTPayload,
          }),
        ),
      );
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.actorType).toBe('operator');
      expect(input.actorId).toBe('operator-1');
    });
  });

  describe('metadata extraction', () => {
    it('extracts the fixed contract code and the exception class name, never a message', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const exception = new NotFoundException({
        code: 'ONBOARDING_NOT_FOUND',
        message: 'ONBOARDING_NOT_FOUND',
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.metadata.code).toBe('ONBOARDING_NOT_FOUND');
      expect(input.metadata.errorName).toBe('NotFoundException');
    });

    it('returns a null code when the exception payload carries none', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);

      filter.catch(new Error('boom'), createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.metadata.code).toBeNull();
    });

    it('extracts fieldErrors from an instance fieldErrors property, as ValidationFailedException exposes', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const exception = new BadRequestException({
        message: ['x'],
        error: 'Bad Request',
        statusCode: 400,
      });
      Object.defineProperty(exception, 'fieldErrors', {
        value: { name: ['isNotEmpty'] },
        enumerable: true,
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.metadata.fieldErrors).toEqual({ name: ['isNotEmpty'] });
    });

    it('extracts fieldErrors from InvalidStepDataException-shaped payload errors', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const exception = new BadRequestException({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { age: ['REQUIRED'] },
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.metadata.fieldErrors).toEqual({ age: ['REQUIRED'] });
    });

    it('folds ConnectorSettingsInvalidException-shaped issues into a field -> reasons map', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const exception = new BadRequestException({
        code: 'CONNECTOR_SETTINGS_INVALID',
        message: 'CONNECTOR_SETTINGS_INVALID',
        issues: [
          { key: 'apiKey', reason: 'missing_required_key' },
          { key: 'apiKey', reason: 'invalid_format' },
        ],
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.metadata.fieldErrors).toEqual({
        apiKey: ['missing_required_key', 'invalid_format'],
      });
    });

    it('retains a fieldErrors key of __proto__ instead of silently dropping it', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      // Built via JSON.parse, exactly as a request body reaches the engine: unlike an object
      // literal - where `__proto__` sets the prototype - this creates a real own property.
      const errors = JSON.parse('{"__proto__":["UNKNOWN"],"age":["REQUIRED"]}') as Record<
        string,
        string[]
      >;
      const exception = new BadRequestException({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors,
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      const recorded = (input.metadata.fieldErrors ?? {}) as Record<string, readonly string[]>;
      expect(Object.prototype.hasOwnProperty.call(recorded, '__proto__')).toBe(true);
      expect(recorded['__proto__']).toEqual(['UNKNOWN']);
      expect(recorded['age']).toEqual(['REQUIRED']);
      expect(Object.keys(recorded).sort()).toEqual(['__proto__', 'age']);
    });

    it('does not throw when a connector-settings issue key is __proto__', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      // `issues` carries the key as a string in an array element, so a caller-submitted setting
      // named `__proto__` reaches the fold verbatim. On a plain accumulator
      // `(folded[key] ??= []).push(...)` reads `Object.prototype` and throws - inside `catch`,
      // after `super.catch` has already sent the response.
      const exception = new BadRequestException({
        code: 'CONNECTOR_SETTINGS_INVALID',
        message: 'CONNECTOR_SETTINGS_INVALID',
        issues: [{ key: '__proto__', reason: 'undeclared_key' }],
      });

      expect(() => filter.catch(exception, createHost(notFoundRequest()))).not.toThrow();
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      const recorded = (input.metadata.fieldErrors ?? {}) as Record<string, readonly string[]>;
      expect(Object.prototype.hasOwnProperty.call(recorded, '__proto__')).toBe(true);
      expect(recorded['__proto__']).toEqual(['undeclared_key']);
      expect(Object.keys(recorded)).toEqual(['__proto__']);
    });

    it('retains an identifier-shaped fieldErrors map', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const exception = new BadRequestException({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { age: ['REQUIRED'], name: ['isNotEmpty', 'UNKNOWN'] },
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.metadata.fieldErrors).toEqual({
        age: ['REQUIRED'],
        name: ['isNotEmpty', 'UNKNOWN'],
      });
    });

    it('drops fieldErrors entirely when any reason is a rendered sentence rather than an identifier', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const exception = new BadRequestException({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: {
          age: ['REQUIRED'],
          role: ['must be one of the following values: a, b, c'],
        },
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.metadata.fieldErrors).toBeUndefined();
    });
  });

  describe('data boundary', () => {
    it('truncates the raw-path route to the metadata string bound when Nest matched no route', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const longPath = `/v1/${'a'.repeat(API_FAILURE_METADATA_STRING_MAX_LENGTH + 50)}`;

      filter.catch(new Error('boom'), createHost(buildRequest({ method: 'GET', path: longPath })));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      expect(input.metadata.route.length).toBe(API_FAILURE_METADATA_STRING_MAX_LENGTH);
      expect(input.metadata.route).toBe(longPath.slice(0, API_FAILURE_METADATA_STRING_MAX_LENGTH));
      expect(input.resourceId.length).toBeLessThanOrEqual(API_FAILURE_METADATA_STRING_MAX_LENGTH);
    });

    it('truncates each routeParams value and caps how many are retained', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const params: Record<string, string> = {
        id: 'x'.repeat(API_FAILURE_METADATA_STRING_MAX_LENGTH + 50),
      };

      for (let index = 0; index < API_FAILURE_MAX_ROUTE_PARAMS + 5; index += 1) {
        params[`extra${index}`] = 'y';
      }

      filter.catch(
        new NotFoundException({ code: 'X', message: 'X' }),
        createHost(
          buildRequest({
            method: 'GET',
            path: '/v1/onboardings/real-id-123',
            route: { path: '/v1/onboardings/:id' },
            params,
          }),
        ),
      );
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      const routeParams = input.metadata.routeParams as Record<string, string>;
      expect(routeParams.id.length).toBe(API_FAILURE_METADATA_STRING_MAX_LENGTH);
      expect(Object.keys(routeParams).length).toBe(API_FAILURE_MAX_ROUTE_PARAMS);
    });

    it('truncates each fieldErrors key and caps how many are retained', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const errors: Record<string, string[]> = {
        [`x`.repeat(API_FAILURE_METADATA_STRING_MAX_LENGTH + 50)]: ['REQUIRED'],
      };

      for (let index = 0; index < API_FAILURE_MAX_FIELD_ERRORS + 5; index += 1) {
        errors[`field${index}`] = ['REQUIRED'];
      }

      const exception = new BadRequestException({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors,
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      const fieldErrors = input.metadata.fieldErrors as Record<string, string[]>;
      const keys = Object.keys(fieldErrors);
      expect(keys.length).toBe(API_FAILURE_MAX_FIELD_ERRORS);
      expect(keys.every((key) => key.length <= API_FAILURE_METADATA_STRING_MAX_LENGTH)).toBe(true);
    });

    it('caps how many reasons a single fieldErrors key retains', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const reasons = Array.from(
        { length: API_FAILURE_MAX_FIELD_ERROR_REASONS + 5 },
        (_unused, index) => `REASON_${index}`,
      );
      const exception = new BadRequestException({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { age: reasons },
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      const fieldErrors = input.metadata.fieldErrors as Record<string, string[]>;
      expect(fieldErrors.age).toEqual(reasons.slice(0, API_FAILURE_MAX_FIELD_ERROR_REASONS));
      expect(fieldErrors.age.length).toBe(API_FAILURE_MAX_FIELD_ERROR_REASONS);
    });

    it('keeps the first key when two keys collide after truncation, rather than the second overwriting it', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const prefix = 'x'.repeat(API_FAILURE_METADATA_STRING_MAX_LENGTH);
      const exception = new BadRequestException({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: {
          [`${prefix}first`]: ['REQUIRED'],
          [`${prefix}second`]: ['UNKNOWN'],
        },
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      const [, input] = auditService.logApiFailure.mock.calls[0] as [
        DataSource,
        ApiFailureAuditInput,
      ];
      const fieldErrors = input.metadata.fieldErrors as Record<string, string[]>;
      expect(Object.keys(fieldErrors).length).toBe(1);
      expect(fieldErrors[prefix]).toEqual(['REQUIRED']);
    });

    it('logs a warning naming what was dropped when a cap or truncation fires', async () => {
      const auditService = createAuditServiceMock();
      const filter = createFilter(auditService);
      const loggerWarnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const prefix = 'x'.repeat(API_FAILURE_METADATA_STRING_MAX_LENGTH);
      const exception = new BadRequestException({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: {
          [`${prefix}first`]: ['REQUIRED'],
          [`${prefix}second`]: ['UNKNOWN'],
        },
      });

      filter.catch(exception, createHost(notFoundRequest()));
      await filter.flushApiFailureAudits();

      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('collides'));

      loggerWarnSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('drains scheduled writes before resolving', async () => {
      const auditService = createAuditServiceMock();
      let resolveWrite!: () => void;
      auditService.logApiFailure.mockReturnValue(
        new Promise((resolve) => {
          resolveWrite = () => resolve(undefined);
        }),
      );
      const filter = createFilter(auditService);

      filter.catch(new Error('boom'), createHost(notFoundRequest()));

      resolveWrite();
      await expect(filter.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
