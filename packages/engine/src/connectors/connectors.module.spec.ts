import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { OnboardingEntity } from '../onboardings/entity/onboarding.entity';
import { WorkflowConnectorSelectionEntity } from '../workflows/entity/workflow-connector-selection.entity';
import { WorkflowEntity } from '../workflows/entity/workflow.entity';
import { WorkflowVersionEntity } from '../workflows/entity/workflow-version.entity';
import { OBJECT_STORAGE_PORT } from '../storage/object-storage.port';
import { ConnectorEntity } from './entity/connector.entity';
import { MockAsyncCallbackConnector } from './adapters/fixtures/mock-async-callback.connector';
import { MockKyc2Connector } from './adapters/fixtures/mock-kyc.connector';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  type ConnectorAdapter,
} from './ports/connector-adapter.port';
import {
  CONNECTOR_ERROR_HANDLER_COLLECTION,
  type ConnectorErrorHandler,
} from './ports/connector-error-handler.port';
import { SendgridEmailConnector } from './adapters/built-in/sendgrid-email.connector';
import { EmailOtpChannel } from './adapters/built-in/otp/email.otp-channel';
import { DuplicateOtpChannelRegistrationError } from './errors/duplicate-otp-channel-registration.error';
import { OtpConnector } from './adapters/built-in/otp.connector';
import { OtpChallengeEntity } from './entity/otp-challenge.entity';
import { RetryThenFallbackHandler } from './error-handlers/built-in/retry-then-fallback.handler';
import { MockEmailDeliveryConnector } from './adapters/fixtures/mock-email-delivery.connector';
import { MockOtpConnector } from './adapters/fixtures/mock-otp.connector';
import {
  WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
} from './ports/connector-execution.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';
import { CONNECTOR_MOCK_SUBSTITUTIONS } from './connector-mock-substitution';
import { CONNECTOR_ADAPTER_SCOPES, type ConnectorAdapterScopes } from './connector-adapter-scope';
import { ConnectorsModule } from './connectors.module';

const createTestConfigModule = (overrides: Record<string, unknown> = {}) =>
  ConfigModule.forRoot({
    isGlobal: true,
    ignoreEnvFile: true,
    load: [
      () => ({
        HTTP_CONNECTOR_TIMEOUT_MS: 5000,
        HTTP_CONNECTOR_SECRETS: '{}',
        SUMSUB_BASE_URL: 'https://api.sumsub.com',
        SUMSUB_TIMEOUT_MS: 10000,
        VERIFF_BASE_URL: 'https://stationapi.veriff.com',
        VERIFF_TIMEOUT_MS: 10000,
        ...overrides,
      }),
    ],
  });

const testConfigModule = createTestConfigModule();

const testStoragePort = {
  issueUploadTicket: jest.fn(),
  inspectStagedObject: jest.fn(),
  readObject: jest.fn(),
  promoteInspectedObject: jest.fn(),
  deleteStagedObject: jest.fn(),
};

/**
 * Stands in for the real `TypeOrmModule.forRootAsync`, which this isolated
 * module-compile test never sets up. `ConnectorSettingsService` requires a real
 * `DataSource` injection (matching `WorkflowRegistryService`'s pattern), so
 * `ConnectorsModule` needs one resolvable here too. Marked `@Global()` so it is
 * visible to `ConnectorsModule` despite Nest's module encapsulation — the same
 * reason the real `TypeOrmCoreModule` is global in the running application.
 * None of these specs call a `ConnectorSettingsService` method, so the manager
 * stub is never actually used.
 */
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: { manager: {} } }],
  exports: [DataSource],
})
class TestDataSourceModule {}

const compileConnectorsModule = (configModule: DynamicModule | Promise<DynamicModule>) =>
  Test.createTestingModule({ imports: [configModule, ConnectorsModule, TestDataSourceModule] })
    .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
    .useValue({ findOne: jest.fn() })
    .overrideProvider(getRepositoryToken(ConnectorEntity))
    .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
    .overrideProvider(getRepositoryToken(OnboardingEntity))
    .useValue({ findOne: jest.fn() })
    .overrideProvider(getRepositoryToken(OtpChallengeEntity))
    .useValue({})
    .overrideProvider(getRepositoryToken(WorkflowEntity))
    .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
    .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
    .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
    .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
    .useValue({ find: jest.fn(), findOne: jest.fn() })
    .overrideProvider(getRepositoryToken(AuditLogEntity))
    .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
    .overrideProvider(OBJECT_STORAGE_PORT)
    .useValue(testStoragePort)
    .compile();

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ConnectorsModule],
  providers: [
    {
      provide: 'EXECUTION_PORT_CONSUMER',
      inject: [WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT],
      useFactory: (port: unknown) => port,
    },
  ],
  exports: ['EXECUTION_PORT_CONSUMER'],
})
class CallbackExecutionPortConsumerModule {}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ConnectorsModule],
  providers: [
    {
      provide: 'COLLECTION_CONSUMER',
      inject: [CONNECTOR_ADAPTER_COLLECTION],
      useFactory: (collection: unknown) => collection,
    },
  ],
})
class AdapterCollectionConsumerModule {}

describe('ConnectorsModule', () => {
  it('auto-registers exactly one callback-capable mock_async_callback adapter', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(ConnectorEntity))
      .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
      .overrideProvider(getRepositoryToken(OnboardingEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(OtpChallengeEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(WorkflowEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      | readonly {
          id: string;
          type: string;
          name: string;
          supportsAsyncCallback?: boolean;
        }[]
      | undefined;

    expect(adapterCollection).toBeDefined();
    const asyncAdapters =
      adapterCollection?.filter((adapter) => adapter.id === 'mock_async_callback') ?? [];

    expect(asyncAdapters).toHaveLength(1);
    expect(asyncAdapters[0]).toMatchObject({
      name: 'mock_async_callback',
      id: 'mock_async_callback',
      type: 'custom',
      supportsAsyncCallback: true,
    });
  });

  it('registers mock_async_callback_2 as a callback-capable custom adapter', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(ConnectorEntity))
      .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
      .overrideProvider(getRepositoryToken(OnboardingEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(OtpChallengeEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(WorkflowEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      readonly { id: string; type: string; supportsAsyncCallback?: boolean }[] | undefined;
    const adapters =
      adapterCollection?.filter((adapter) => adapter.id === 'mock_async_callback_2') ?? [];

    expect(adapters).toHaveLength(1);
    expect(adapters[0]).toMatchObject({ type: 'custom', supportsAsyncCallback: true });
  });

  it('registers the otp adapter exactly once, built from both channels, without async-callback support', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(ConnectorEntity))
      .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
      .overrideProvider(getRepositoryToken(OnboardingEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(OtpChallengeEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(WorkflowEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      readonly ConnectorAdapter[] | undefined;

    const otpAdapters = adapterCollection?.filter((adapter) => adapter.id === 'otp') ?? [];

    expect(otpAdapters).toHaveLength(1);
    expect(otpAdapters[0]).toMatchObject({
      name: 'otp',
      id: 'otp',
      type: 'otp_verification',
    });
    expect(otpAdapters[0].supportsAsyncCallback).toBeUndefined();
    expect(otpAdapters[0].settingsSchema?.fields.map((field) => field.key)).toEqual([
      'twilioAccountSid',
      'twilioAuthToken',
      'twilioMessagingServiceSid',
    ]);

    expect(moduleRef.get(OtpConnector)).toBeInstanceOf(OtpConnector);
  });

  it('registers the generic http_request adapter with declaration validation', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(ConnectorEntity))
      .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
      .overrideProvider(getRepositoryToken(OnboardingEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(OtpChallengeEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(WorkflowEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      readonly ConnectorAdapter[] | undefined;
    const httpAdapters =
      adapterCollection?.filter((adapter) => adapter.id === 'http_request') ?? [];

    expect(httpAdapters).toHaveLength(1);
    expect(httpAdapters[0].name).toBe('http_request');
    expect(httpAdapters[0].supportsAsyncCallback).toBeUndefined();
    expect(typeof httpAdapters[0].validateDeclaration).toBe('function');
    // Its secrets come from HTTP_CONNECTOR_SECRETS, not from an operator, so it declares no
    // settingsSchema and `/v1/admin/connectors` therefore never lists it.
    expect(httpAdapters[0].settingsSchema).toBeUndefined();
  });

  it('registers the SendGrid adapter exactly once and without async-callback support', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(ConnectorEntity))
      .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
      .overrideProvider(getRepositoryToken(OnboardingEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(OtpChallengeEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(WorkflowEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      readonly ConnectorAdapter[] | undefined;

    const sendgridAdapters =
      adapterCollection?.filter((adapter) => adapter.id === 'sendgrid_email') ?? [];

    expect(sendgridAdapters).toHaveLength(1);
    expect(sendgridAdapters[0]).toMatchObject({
      name: 'sendgrid_email',
      id: 'sendgrid_email',
      type: 'email_delivery',
    });
    expect(sendgridAdapters[0].supportsAsyncCallback).toBeUndefined();

    const sendgridConnector = moduleRef.get(SendgridEmailConnector);
    expect(sendgridConnector).toBeInstanceOf(SendgridEmailConnector);
  });

  it('registers exactly one smtp adapter', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(ConnectorEntity))
      .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
      .overrideProvider(getRepositoryToken(OnboardingEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(OtpChallengeEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(WorkflowEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      | readonly {
          id: string;
          type: string;
          name: string;
        }[]
      | undefined;

    const smtpAdapters = adapterCollection?.filter((adapter) => adapter.id === 'smtp') ?? [];

    expect(smtpAdapters).toHaveLength(1);
    expect(smtpAdapters[0]).toMatchObject({
      name: 'smtp',
      id: 'smtp',
      type: 'email_delivery',
    });
  });

  it('exports the callback-capable execution port and keeps legacy token compatibility', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, CallbackExecutionPortConsumerModule, TestDataSourceModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(ConnectorEntity))
      .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
      .overrideProvider(getRepositoryToken(OnboardingEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(OtpChallengeEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(WorkflowEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
      .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    expect(moduleRef.get('EXECUTION_PORT_CONSUMER')).toBeDefined();
    expect(moduleRef.get(WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT)).toBeDefined();
    expect(moduleRef.get(WORKFLOW_CONNECTOR_EXECUTION_PORT)).toBeDefined();
  });

  it('does not export adapter collection to importing modules', async () => {
    await expect(
      Test.createTestingModule({
        imports: [testConfigModule, AdapterCollectionConsumerModule, TestDataSourceModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(ConnectorEntity))
        .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
        .overrideProvider(getRepositoryToken(OnboardingEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(OtpChallengeEntity))
        .useValue({})
        .overrideProvider(getRepositoryToken(WorkflowEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(AuditLogEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .compile(),
    ).rejects.toThrow(/CONNECTOR_ADAPTER_COLLECTION/);
  });

  it('fails at startup when two registered connectors share the same id', async () => {
    await expect(
      Test.createTestingModule({
        imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(ConnectorEntity))
        .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
        .overrideProvider(getRepositoryToken(OnboardingEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(OtpChallengeEntity))
        .useValue({})
        .overrideProvider(getRepositoryToken(WorkflowEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(AuditLogEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .overrideProvider(MockKyc2Connector)
        .useValue({
          name: 'mock_kyc_2',
          id: 'mock_kyc_1',
          type: 'kyc',
          execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        })
        .compile(),
    ).rejects.toThrow('Duplicate connector adapter registration for id=mock_kyc_1');
  });

  it('fails at startup when a callback-capable connector declares no callback auth', async () => {
    await expect(
      Test.createTestingModule({
        imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(ConnectorEntity))
        .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
        .overrideProvider(getRepositoryToken(OnboardingEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(OtpChallengeEntity))
        .useValue({})
        .overrideProvider(getRepositoryToken(WorkflowEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(AuditLogEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .overrideProvider(MockAsyncCallbackConnector)
        .useValue({
          name: 'mock_async_callback',
          id: 'mock_async_callback',
          type: 'custom',
          supportsAsyncCallback: true,
          execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
          mapCallbackResult: jest.fn(),
        })
        .compile(),
    ).rejects.toThrow(
      'Connector adapter id=mock_async_callback declares supportsAsyncCallback without a callbackAuth contract',
    );
  });

  it('resolves the error-handler collection with all three built-in handlers', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const handlerCollection = moduleRef.get(CONNECTOR_ERROR_HANDLER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorErrorHandler[] | undefined;

    expect(handlerCollection).toBeDefined();
    expect(handlerCollection?.map((handler) => handler.id).sort()).toEqual([
      'continue_on_error',
      'fallback_on_error',
      'retry_then_fallback',
    ]);
  });

  it('fails at startup when two registered error handlers share the same id', async () => {
    await expect(
      Test.createTestingModule({
        imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(ConnectorEntity))
        .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
        .overrideProvider(getRepositoryToken(OnboardingEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(OtpChallengeEntity))
        .useValue({})
        .overrideProvider(getRepositoryToken(WorkflowEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(AuditLogEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .overrideProvider(RetryThenFallbackHandler)
        .useValue({ id: 'fallback_on_error', handle: jest.fn() })
        .compile(),
    ).rejects.toThrow('Duplicate connector error handler registration for id=fallback_on_error');
  });

  it('fails at startup when two registered OTP channels share the same channel', async () => {
    await expect(
      Test.createTestingModule({
        imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(ConnectorEntity))
        .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
        .overrideProvider(getRepositoryToken(OnboardingEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(OtpChallengeEntity))
        .useValue({})
        .overrideProvider(getRepositoryToken(WorkflowEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowVersionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn() })
        .overrideProvider(getRepositoryToken(WorkflowConnectorSelectionEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn() })
        .overrideProvider(getRepositoryToken(AuditLogEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .overrideProvider(EmailOtpChannel)
        .useValue({ channel: 'sms', settingsFields: [], send: jest.fn() })
        .compile(),
    ).rejects.toThrow(DuplicateOtpChannelRegistrationError);
  });

  it('registers the mocks that can stand in for a connector as ordinary fixtures', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];
    const byId = (id: string) => adapterCollection.find((adapter) => adapter.id === id);

    expect(byId('mock_otp')).toBeInstanceOf(MockOtpConnector);
    expect(byId('mock_email_delivery')).toBeInstanceOf(MockEmailDeliveryConnector);

    // Each can be driven asynchronously, which is how the callback path stays covered while
    // every built-in connector is still synchronous.
    expect(byId('mock_otp')?.supportsAsyncCallback).toBe(true);
    expect(byId('mock_email_delivery')?.callbackAuth).toMatchObject({ kind: 'none' });
  });

  it('registers the Veriff KYC adapter exactly once, callback-capable and signed over x-hmac-signature', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];
    const veriffAdapters = adapterCollection.filter((adapter) => adapter.id === 'veriff_kyc');

    expect(veriffAdapters).toHaveLength(1);
    expect(veriffAdapters[0]).toMatchObject({
      name: 'veriff_kyc',
      type: 'kyc',
      supportsAsyncCallback: true,
      callbackAuth: {
        kind: 'hmac',
        algorithm: 'sha256',
        signatureHeader: 'x-hmac-signature',
        encoding: 'hex',
        secretSettingKey: 'sharedSecretKey',
      },
    });
    expect(veriffAdapters[0].settingsSchema?.fields.map((field) => field.key)).toEqual([
      'apiKey',
      'sharedSecretKey',
    ]);
  });

  it('resolves the scope map, reporting shipped adapters as built-in and mocks as fixtures', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const scopes = moduleRef.get(CONNECTOR_ADAPTER_SCOPES, {
      strict: false,
    }) as ConnectorAdapterScopes | undefined;

    expect(scopes).toBeDefined();
    expect(scopes?.get('sendgrid_email')).toBe('built-in');
    expect(scopes?.get('otp')).toBe('built-in');
    expect(scopes?.get('smtp')).toBe('built-in');
    expect(scopes?.get('http_request')).toBe('built-in');
    expect(scopes?.get('veriff_kyc')).toBe('built-in');
    expect(scopes?.get('mock_email_delivery')).toBe('fixtures');
    expect(scopes?.get('mock_otp')).toBe('fixtures');
  });

  it('substitutes nothing while CONNECTOR_MOCKS is empty', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    expect(moduleRef.get(CONNECTOR_MOCK_SUBSTITUTIONS, { strict: false })).toEqual(new Map());
    // The real connectors stay in place, mocks and all.
    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];
    expect(adapterCollection.find((adapter) => adapter.id === 'otp')).toBeInstanceOf(OtpConnector);
    expect(adapterCollection.find((adapter) => adapter.id === 'sendgrid_email')).toBeInstanceOf(
      SendgridEmailConnector,
    );
  });

  it('resolves each configured connector-to-mock pair', async () => {
    const moduleRef = await compileConnectorsModule(
      createTestConfigModule({
        CONNECTOR_MOCKS: 'otp:mock_otp,sendgrid_email:mock_email_delivery',
      }),
    );

    expect(moduleRef.get(CONNECTOR_MOCK_SUBSTITUTIONS, { strict: false })).toEqual(
      new Map([
        ['otp', 'mock_otp'],
        ['sendgrid_email', 'mock_email_delivery'],
      ]),
    );
  });

  it('ignores the configured pairs outside a test run', async () => {
    const moduleRef = await compileConnectorsModule(
      createTestConfigModule({
        NODE_ENV: 'development',
        CONNECTOR_MOCKS: 'otp:mock_otp',
      }),
    );

    expect(moduleRef.get(CONNECTOR_MOCK_SUBSTITUTIONS, { strict: false })).toEqual(new Map());
    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];
    expect(adapterCollection.find((adapter) => adapter.id === 'otp')).toBeInstanceOf(OtpConnector);
  });

  it('fails a test run when a configured pair names an unregistered mock or connector', async () => {
    await expect(
      compileConnectorsModule(createTestConfigModule({ CONNECTOR_MOCKS: 'otp:mock_nonexistent' })),
    ).rejects.toThrow('no adapter is registered as id=mock_nonexistent');

    await expect(
      compileConnectorsModule(
        createTestConfigModule({ CONNECTOR_MOCKS: 'vonage_verify:mock_otp' }),
      ),
    ).rejects.toThrow('asks for id=vonage_verify to be mocked, but no adapter serves it');
  });
});
