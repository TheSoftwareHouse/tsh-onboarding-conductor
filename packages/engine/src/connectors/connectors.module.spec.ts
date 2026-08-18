import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Module } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { OBJECT_STORAGE_PORT } from '../storage/object-storage.port';
import { MockKyc2Connector } from './adapters/sandbox/mock-kyc-2.connector';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  ConnectorTier,
  type ConnectorAdapter,
} from './ports/connector-adapter.port';
import { SendgridEmailConnector } from './adapters/production/sendgrid-email.connector';
import { TwilioVerifyConnector } from './adapters/production/twilio-verify.connector';
import {
  WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
} from './ports/connector-execution.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';
import { ConnectorsModule } from './connectors.module';

const testConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  ignoreEnvFile: true,
  load: [() => ({ HTTP_CONNECTOR_TIMEOUT_MS: 5000, HTTP_CONNECTOR_SECRETS: '{}' })],
});

const sandboxConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  ignoreEnvFile: true,
  load: [
    () => ({
      HTTP_CONNECTOR_TIMEOUT_MS: 5000,
      HTTP_CONNECTOR_SECRETS: '{}',
      SANDBOX_CONNECTORS_ENABLED: true,
    }),
  ],
});

const testStoragePort = {
  issueUploadTicket: jest.fn(),
  inspectStagedObject: jest.fn(),
  readObject: jest.fn(),
  promoteInspectedObject: jest.fn(),
  deleteStagedObject: jest.fn(),
};

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
  it('auto-registers exactly one callback-capable mock_async_callback adapter when the sandbox tier is enabled', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [sandboxConfigModule, ConnectorsModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

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
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

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
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

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
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

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

  it('registers exactly one smtp_email adapter', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, { strict: false }) as
      | readonly {
          type: string;
          name: string;
        }[]
      | undefined;

    const smtpAdapters =
      adapterCollection?.filter((adapter) => adapter.type === 'smtp_email') ?? [];

    expect(smtpAdapters).toHaveLength(1);
    expect(smtpAdapters[0]).toMatchObject({
      name: 'smtp_email',
      type: 'smtp_email',
    });
  });

  it('exports the callback-capable execution port and keeps legacy token compatibility', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, CallbackExecutionPortConsumerModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
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
        imports: [testConfigModule, AdapterCollectionConsumerModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .compile(),
    ).rejects.toThrow(/CONNECTOR_ADAPTER_COLLECTION/);
  });

  it('fails at startup when two registered connectors share the same type', async () => {
    await expect(
      Test.createTestingModule({
        imports: [sandboxConfigModule, ConnectorsModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .overrideProvider(MockKyc2Connector)
        .useValue({
          name: 'mock_kyc_2',
          type: 'mock_kyc_1',
          tier: ConnectorTier.SANDBOX,
          execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        })
        .compile(),
    ).rejects.toThrow('Duplicate connector adapter registration for type=mock_kyc_1');
  });

  it('registers no sandbox adapters by default', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule, ConnectorsModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];

    expect(adapterCollection.every((adapter) => adapter.tier === ConnectorTier.PRODUCTION)).toBe(
      true,
    );
    expect(adapterCollection.map((adapter) => adapter.type).sort()).toEqual([
      'http_request',
      'sendgrid_email',
      'smtp_email',
      'twilio_verify',
    ]);
  });

  it('registers both tiers when the sandbox tier is enabled', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [sandboxConfigModule, ConnectorsModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(testStoragePort)
      .compile();

    const adapterCollection = moduleRef.get(CONNECTOR_ADAPTER_COLLECTION, {
      strict: false,
    }) as readonly ConnectorAdapter[];

    expect(
      adapterCollection.filter((adapter) => adapter.tier === ConnectorTier.SANDBOX),
    ).toHaveLength(6);
  });

  it('fails at startup when an adapter is registered against a tier it does not declare', async () => {
    await expect(
      Test.createTestingModule({
        imports: [sandboxConfigModule, ConnectorsModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .overrideProvider(SendgridEmailConnector)
        .useValue({
          name: 'sendgrid_email',
          type: 'sendgrid_email',
          tier: ConnectorTier.SANDBOX,
          execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        })
        .compile(),
    ).rejects.toThrow(
      'Connector type=sendgrid_email is registered as production but declares tier=sandbox',
    );
  });
});
