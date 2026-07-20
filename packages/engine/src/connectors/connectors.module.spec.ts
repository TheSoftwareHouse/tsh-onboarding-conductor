import { Test } from '@nestjs/testing';
import { WORKFLOW_CONNECTOR_EXECUTION_PORT } from './connector-execution.port';
import { CONNECTOR_ADAPTER_COLLECTION } from './connector.adapter';
import { ConnectorsModule } from './connectors.module';
import { TshKyc2Connector } from './tsh-kyc-2.connector';

describe('ConnectorsModule', () => {
  it('compiles when each registered connector type is unique', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConnectorsModule],
    }).compile();

    expect(moduleRef.get(WORKFLOW_CONNECTOR_EXECUTION_PORT)).toBeDefined();
    expect(moduleRef.get(CONNECTOR_ADAPTER_COLLECTION)).toEqual([
      expect.objectContaining({ name: 'tsh_kyc_1', type: 'mock_kyc_1' }),
      expect.objectContaining({ name: 'tsh_kyc_2', type: 'mock_kyc_2' }),
    ]);
  });

  it('fails at startup when two registered connectors share the same type', async () => {
    await expect(
      Test.createTestingModule({
        imports: [ConnectorsModule],
      })
        .overrideProvider(TshKyc2Connector)
        .useValue({
          name: 'tsh_kyc_2',
          type: 'mock_kyc_1',
          verify: jest.fn().mockResolvedValue(true),
        })
        .compile(),
    ).rejects.toThrow('Duplicate connector types are invalid at startup: mock_kyc_1');
  });
});
