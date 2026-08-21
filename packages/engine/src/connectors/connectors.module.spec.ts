import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConnectorSettingEntity } from '../connector-settings/entity/connector-setting.entity';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { OBJECT_STORAGE_PORT } from '../storage/object-storage.port';
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

const withTestProviders = (builder: ReturnType<typeof Test.createTestingModule>) =>
  builder
    .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
    .useValue({ findOne: jest.fn() })
    // The built-in adapters read their credentials from the connector settings table.
    .overrideProvider(getRepositoryToken(ConnectorSettingEntity))
    .useValue({ findOne: jest.fn() })
    .overrideProvider(OBJECT_STORAGE_PORT)
    .useValue(testStoragePort);

const compileConnectorsModule = (configModule: DynamicModule | Promise<DynamicModule>) =>
  withTestProviders(
    Test.createTestingModule({ imports: [configModule, ConnectorsModule] }),
  ).compile();

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
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      | readonly {
          type: string;
          name: string;
          supportsAsyncCallback?: boolean;
        }[]
      | undefined;

    expect(adapterCollection).toBeDefined();
    const asyncAdapters =
      adapterCollection?.filter((adapter) => adapter.type === 'mock_async_callback') ?? [];

    expect(asyncAdapters).toHaveLength(1);
    expect(asyncAdapters[0]).toMatchObject({
      name: 'mock_async_callback',
      type: 'mock_async_callback',
      supportsAsyncCallback: true,
    });
  });

  it('registers the Twilio Verify adapter exactly once and without async-callback support', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      readonly ConnectorAdapter[] | undefined;

    const twilioAdapters =
      adapterCollection?.filter((adapter) => adapter.type === 'twilio_verify') ?? [];

    expect(twilioAdapters).toHaveLength(1);
    expect(twilioAdapters[0]).toMatchObject({
      name: 'twilio_verify',
      type: 'twilio_verify',
    });
    expect(twilioAdapters[0].supportsAsyncCallback).toBeUndefined();

    const twilioConnector = moduleRef.get(TwilioVerifyConnector);
    expect(twilioConnector).toBeInstanceOf(TwilioVerifyConnector);
  });

  it('registers the generic http_request adapter with declaration validation', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      readonly ConnectorAdapter[] | undefined;
    const httpAdapters =
      adapterCollection?.filter((adapter) => adapter.type === 'http_request') ?? [];

    expect(httpAdapters).toHaveLength(1);
    expect(httpAdapters[0].name).toBe('http_request');
    expect(httpAdapters[0].supportsAsyncCallback).toBeUndefined();
    expect(typeof httpAdapters[0].validateDeclaration).toBe('function');
  });

  it('registers the SendGrid adapter exactly once and without async-callback support', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      readonly ConnectorAdapter[] | undefined;

    const sendgridAdapters =
      adapterCollection?.filter((adapter) => adapter.type === 'sendgrid_email') ?? [];

    expect(sendgridAdapters).toHaveLength(1);
    expect(sendgridAdapters[0]).toMatchObject({
      name: 'sendgrid_email',
      type: 'sendgrid_email',
    });
    expect(sendgridAdapters[0].supportsAsyncCallback).toBeUndefined();

    const sendgridConnector = moduleRef.get(SendgridEmailConnector);
    expect(sendgridConnector).toBeInstanceOf(SendgridEmailConnector);
  });

  it('registers exactly one smtp adapter', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      | readonly {
          type: string;
          name: string;
        }[]
      | undefined;

    const smtpAdapters = adapterCollection?.filter((adapter) => adapter.type === 'smtp') ?? [];

    expect(smtpAdapters).toHaveLength(1);
    expect(smtpAdapters[0]).toMatchObject({
      name: 'SmtpConnector',
      type: 'smtp',
    });
  });

  it('exports the callback-capable execution port and keeps legacy token compatibility', async () => {
    const moduleRef = await withTestProviders(
      Test.createTestingModule({
        imports: [testConfigModule, CallbackExecutionPortConsumerModule],
      }),
    ).compile();

    expect(moduleRef.get('EXECUTION_PORT_CONSUMER')).toBeDefined();
    expect(moduleRef.get(WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT)).toBeDefined();
    expect(moduleRef.get(WORKFLOW_CONNECTOR_EXECUTION_PORT)).toBeDefined();
  });

  it('does not export adapter collection to importing modules', async () => {
    await expect(
      withTestProviders(
        Test.createTestingModule({ imports: [testConfigModule, AdapterCollectionConsumerModule] }),
      ).compile(),
    ).rejects.toThrow(/CONNECTOR_ADAPTER_COLLECTION/);
  });

  it('fails at startup when two registered connectors share the same type', async () => {
    await expect(
      withTestProviders(Test.createTestingModule({ imports: [testConfigModule, ConnectorsModule] }))
        .overrideProvider(TshKyc2Connector)
        .useValue({
          name: 'tsh_kyc_2',
          type: 'mock_kyc_1',
          execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        })
        .compile(),
    ).rejects.toThrow('Duplicate connector adapter registration for type=mock_kyc_1');
  });

  it('fails at startup when a callback-capable connector declares no callback auth', async () => {
    await expect(
      withTestProviders(Test.createTestingModule({ imports: [testConfigModule, ConnectorsModule] }))
        .overrideProvider(MockAsyncCallbackConnector)
        .useValue({
          name: 'mock_async_callback',
          type: 'mock_async_callback',
          supportsAsyncCallback: true,
          execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
          mapCallbackResult: jest.fn(),
        })
        .compile(),
    ).rejects.toThrow(
      'Connector adapter type=mock_async_callback declares supportsAsyncCallback without a callbackAuth contract',
    );
  });

  it('registers the mocks that can stand in for a connector as ordinary fixtures', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];
    const byType = (type: string) => adapterCollection.find((adapter) => adapter.type === type);

    expect(byType('mock_phone_verification')).toBeInstanceOf(MockPhoneVerificationConnector);
    expect(byType('mock_email_verification')).toBeInstanceOf(MockEmailVerificationConnector);
    expect(byType('mock_email_delivery')).toBeInstanceOf(MockEmailDeliveryConnector);

    // Each can be driven asynchronously, which is how the callback path stays covered while
    // every built-in connector is still synchronous.
    expect(byType('mock_phone_verification')?.supportsAsyncCallback).toBe(true);
    expect(byType('mock_email_delivery')?.callbackAuth).toMatchObject({ kind: 'none' });
  });

  it('substitutes nothing while CONNECTOR_MOCKS is empty', async () => {
    const moduleRef = await compileConnectorsModule(testConfigModule);

    expect(moduleRef.get(CONNECTOR_MOCK_SUBSTITUTIONS, { strict: false })).toEqual(new Map());
    // The real connectors stay in place, mocks and all.
    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];
    expect(adapterCollection.find((adapter) => adapter.type === 'twilio_verify')).toBeInstanceOf(
      TwilioVerifyConnector,
    );
    expect(adapterCollection.find((adapter) => adapter.type === 'sendgrid_email')).toBeInstanceOf(
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
    expect(adapterCollection.find((adapter) => adapter.type === 'twilio_verify')).toBeInstanceOf(
      TwilioVerifyConnector,
    );
  });

  it('fails a test run when a configured pair names an unregistered mock or connector', async () => {
    await expect(
      compileConnectorsModule(
        createTestConfigModule({ CONNECTOR_MOCKS: 'twilio_verify:mock_nonexistent' }),
      ),
    ).rejects.toThrow('no adapter is registered as type=mock_nonexistent');

    await expect(
      compileConnectorsModule(
        createTestConfigModule({ CONNECTOR_MOCKS: 'vonage_verify:mock_phone_verification' }),
      ),
    ).rejects.toThrow('asks for type=vonage_verify to be mocked, but no adapter serves it');
  });
});
