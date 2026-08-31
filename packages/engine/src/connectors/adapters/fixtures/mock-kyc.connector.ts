import { Injectable } from '@nestjs/common';
import type { ConnectorAdapter, ConnectorExecutionInput } from '../../ports/connector-adapter.port';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';

/** Long enough for a caller to observe a step that is still running its connectors. */
const DELIBERATION_MILLISECONDS = 5_000;

/**
 * KYC with no provider behind it: it reads nothing from the declaration and accepts every
 * applicant once the delay above has passed.
 *
 * Two are registered rather than one because a step may declare several connectors and run them
 * in `order`, and `workflows/fixtures/base.workflow.json` needs two distinct ids to show that.
 * They differ in nothing but their id.
 */
abstract class AlwaysAcceptKycMockConnector implements ConnectorAdapter {
  readonly type = 'kyc' as const;

  protected constructor(
    readonly name: string,
    readonly id: string,
  ) {}

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    void input;
    await this.wait(DELIBERATION_MILLISECONDS);
    return ConnectorExecutionResult.accepted();
  }

  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}

@Injectable()
export class MockKyc1Connector extends AlwaysAcceptKycMockConnector {
  constructor() {
    super('mock_kyc_1', 'mock_kyc_1');
  }
}

@Injectable()
export class MockKyc2Connector extends AlwaysAcceptKycMockConnector {
  constructor() {
    super('mock_kyc_2', 'mock_kyc_2');
  }
}
