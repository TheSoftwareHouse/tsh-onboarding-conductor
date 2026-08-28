import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { OBJECT_STORAGE_PORT } from '../storage/object-storage.port';
import { ConnectorEntity } from './entity/connector.entity';
import { MockAsyncCallbackConnector } from './adapters/fixtures/mock-async-callback.connector';
import { TshKyc2Connector } from './adapters/fixtures/tsh-kyc-2.connector';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  type ConnectorAdapter,
} from './ports/connector-adapter.port';
import { SendgridEmailConnector } from './adapters/built-in/sendgrid-email.connector';
import { TwilioVerifyConnector } from './adapters/built-in/twilio-verify.connector';
import { MockEmailDeliveryConnector } from './adapters/fixtures/mock-email-delivery.connector';
import {
  MockEmailVerificationConnector,
  MockPhoneVerificationConnector,
} from './adapters/fixtures/mock-verification.connector';
import {
  WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
} from './ports/connector-execution.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';
import { CONNECTOR_MOCK_SUBSTITUTIONS } from './connector-mock-substitution';
import { ConnectorsModule } from './connectors.module';

const createTestConfigModule = (overrides: Record<string, unknown> = {}) =>
  ConfigModule.forRoot({
    isGlobal: true,
    ignoreEnvFile: true,
    load: [() => ({ HTTP_CONNECTOR_TIMEOUT_MS: 5000, HTTP_CONNECTOR_SECRETS: '{}', ...overrides })],
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

  it('registers the Twilio Verify adapter exactly once and without async-callback support', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(ConnectorEntity))
      .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      readonly ConnectorAdapter[] | undefined;

    const twilioAdapters =
      adapterCollection?.filter((adapter) => adapter.id === 'twilio_verify') ?? [];

    expect(twilioAdapters).toHaveLength(1);
    expect(twilioAdapters[0]).toMatchObject({
      name: 'twilio_verify',
      id: 'twilio_verify',
      type: 'phone_verification',
    });
    expect(twilioAdapters[0].supportsAsyncCallback).toBeUndefined();

    const twilioConnector = moduleRef.get(TwilioVerifyConnector);
    expect(twilioConnector).toBeInstanceOf(TwilioVerifyConnector);
  });

  it('registers the generic http_request adapter with declaration validation', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule, TestDataSourceModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(ConnectorEntity))
      .useValue({ find: jest.fn(), findAll: jest.fn(), save: jest.fn(), delete: jest.fn() })
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
        .overrideProvider(getRepositoryToken(AuditLogEntity))
        .useValue({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .overrideProvider(TshKyc2Connector)
        .useValue({
          name: 'tsh_kyc_2',
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

  it('registers the mocks that can stand in for a connector as ordinary fixtures', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];
    const byId = (id: string) => adapterCollection.find((adapter) => adapter.id === id);

    expect(byId('mock_phone_verification')).toBeInstanceOf(MockPhoneVerificationConnector);
    expect(byId('mock_email_verification')).toBeInstanceOf(MockEmailVerificationConnector);
    expect(byId('mock_email_delivery')).toBeInstanceOf(MockEmailDeliveryConnector);

    // Each can be driven asynchronously, which is how the callback path stays covered while
    // every built-in connector is still synchronous.
    expect(byId('mock_phone_verification')?.supportsAsyncCallback).toBe(true);
    expect(byId('mock_email_delivery')?.callbackAuth).toMatchObject({ kind: 'none' });
  });

  it('substitutes nothing while CONNECTOR_MOCKS is empty', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    expect(moduleRef.get(CONNECTOR_MOCK_SUBSTITUTIONS, { strict: false })).toEqual(new Map());
    // The real connectors stay in place, mocks and all.
    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];
    expect(adapterCollection.find((adapter) => adapter.id === 'twilio_verify')).toBeInstanceOf(
      TwilioVerifyConnector,
    );
    expect(adapterCollection.find((adapter) => adapter.id === 'sendgrid_email')).toBeInstanceOf(
      SendgridEmailConnector,
    );
  });

  it('resolves each configured connector-to-mock pair', async () => {
    const moduleRef = await compileConnectorsModule(
      createTestConfigModule({
        CONNECTOR_MOCKS: 'twilio_verify:mock_phone_verification,sendgrid_email:mock_email_delivery',
      }),
    );

    expect(moduleRef.get(CONNECTOR_MOCK_SUBSTITUTIONS, { strict: false })).toEqual(
      new Map([
        ['twilio_verify', 'mock_phone_verification'],
        ['sendgrid_email', 'mock_email_delivery'],
      ]),
    );
  });

  it('ignores the configured pairs outside a test run', async () => {
    const moduleRef = await compileConnectorsModule(
      createTestConfigModule({
        NODE_ENV: 'development',
        CONNECTOR_MOCKS: 'twilio_verify:mock_phone_verification',
      }),
    );

    expect(moduleRef.get(CONNECTOR_MOCK_SUBSTITUTIONS, { strict: false })).toEqual(new Map());
    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];
    expect(adapterCollection.find((adapter) => adapter.id === 'twilio_verify')).toBeInstanceOf(
      TwilioVerifyConnector,
    );
  });

  it('fails a test run when a configured pair names an unregistered mock or connector', async () => {
    await expect(
      compileConnectorsModule(
        createTestConfigModule({ CONNECTOR_MOCKS: 'twilio_verify:mock_nonexistent' }),
      ),
    ).rejects.toThrow('no adapter is registered as id=mock_nonexistent');

    await expect(
      compileConnectorsModule(
        createTestConfigModule({ CONNECTOR_MOCKS: 'vonage_verify:mock_phone_verification' }),
      ),
    ).rejects.toThrow('asks for id=vonage_verify to be mocked, but no adapter serves it');
  });
});
