import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { OBJECT_STORAGE_PORT } from '../storage/object-storage.port';
import { TshKyc2Connector } from './adapters/tsh-kyc-2.connector';
import { CONNECTOR_ADAPTER_COLLECTION } from './ports/connector-adapter.port';
import { WORKFLOW_CONNECTOR_EXECUTION_PORT } from './ports/connector-execution.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';
import { ConnectorsModule } from './connectors.module';

describe('ConnectorsModule', () => {
  it('compiles when each registered connector type is unique', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConnectorsModule],
    })
      .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue({
        issueUploadTicket: jest.fn(),
        inspectStagedObject: jest.fn(),
        readObject: jest.fn(),
        promoteInspectedObject: jest.fn(),
        deleteStagedObject: jest.fn(),
      })
      .compile();

    expect(moduleRef.get(WORKFLOW_CONNECTOR_EXECUTION_PORT)).toBeDefined();
    expect(moduleRef.get(CONNECTOR_ADAPTER_COLLECTION)).toEqual([
      expect.objectContaining({ name: 'tsh_kyc_1', type: 'mock_kyc_1' }),
      expect.objectContaining({ name: 'tsh_kyc_2', type: 'mock_kyc_2' }),
      expect.objectContaining({ name: 'mock_email_otp', type: 'mock_email_otp' }),
      expect.objectContaining({ name: 'mock_sms_otp', type: 'mock_sms_otp' }),
      expect.objectContaining({ name: 'mock_sumsub_file_upload', type: 'mock_sumsub_file_upload' }),
    ]);
  });

  it('fails at startup when two registered connectors share the same type', async () => {
    await expect(
      Test.createTestingModule({
        imports: [ConnectorsModule],
      })
        .overrideProvider(getRepositoryToken(OnboardingDocumentEntity))
        .useValue({ findOne: jest.fn() })
        .overrideProvider(OBJECT_STORAGE_PORT)
        .useValue({
          issueUploadTicket: jest.fn(),
          inspectStagedObject: jest.fn(),
          readObject: jest.fn(),
          promoteInspectedObject: jest.fn(),
          deleteStagedObject: jest.fn(),
        })
        .overrideProvider(TshKyc2Connector)
        .useValue({
          name: 'tsh_kyc_2',
          type: 'mock_kyc_1',
          verify: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        })
        .compile(),
    ).rejects.toThrow('Duplicate connector adapter registration for type=mock_kyc_1');
  });
});
