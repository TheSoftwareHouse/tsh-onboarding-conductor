import { Test } from '@nestjs/testing';
import { Module } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { OBJECT_STORAGE_PORT } from '../storage/object-storage.port';
import { TshKyc2Connector } from './adapters/tsh-kyc-2.connector';
import { CONNECTOR_ADAPTER_COLLECTION } from './ports/connector-adapter.port';
import { TwilioVerifyConnector } from './adapters/twilio-verify.connector';
import {
  WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
} from './ports/connector-execution.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';
import { ConnectorsModule } from './connectors.module';

const testStoragePort = {
  issueUploadTicket: jest.fn(),
  inspectStagedObject: jest.fn(),
  readObject: jest.fn(),
  promoteInspectedObject: jest.fn(),
  deleteStagedObject: jest.fn(),
};

@Module({
  imports: [ConnectorsModule],
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
  imports: [ConnectorsModule],
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
      imports: [ConnectorsModule],
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
      imports: [ConnectorsModule],
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

  it('exports the callback-capable execution port and keeps legacy token compatibility', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CallbackExecutionPortConsumerModule],
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
        imports: [AdapterCollectionConsumerModule],
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
        imports: [ConnectorsModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue(testStoragePort)
        .overrideProvider(TshKyc2Connector)
        .useValue({
          name: 'tsh_kyc_2',
          type: 'mock_kyc_1',
          execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        })
        .compile(),
    ).rejects.toThrow('Duplicate connector adapter registration for type=mock_kyc_1');
  });
});
