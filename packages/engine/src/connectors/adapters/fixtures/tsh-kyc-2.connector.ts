import { Injectable } from '@nestjs/common';
import type { ConnectorAdapter, ConnectorExecutionInput } from '../../ports/connector-adapter.port';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';

@Injectable()
export class TshKyc2Connector implements ConnectorAdapter {
  readonly name = 'tsh_kyc_2';
  readonly id = 'mock_kyc_2';
  readonly type = 'kyc' as const;

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
