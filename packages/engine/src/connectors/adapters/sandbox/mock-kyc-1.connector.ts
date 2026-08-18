import { Injectable } from '@nestjs/common';
import { ConnectorTier } from '../../ports/connector-adapter.port';
import type { ConnectorAdapter, ConnectorExecutionInput } from '../../ports/connector-adapter.port';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';

@Injectable()
export class MockKyc1Connector implements ConnectorAdapter {
  readonly name = 'mock_kyc_1';
  readonly type = 'mock_kyc_1';
  readonly tier = ConnectorTier.SANDBOX;

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    void input;
    await this.wait(5_000);
    return ConnectorExecutionResult.accepted();
  }

  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
