import { Injectable } from '@nestjs/common';
import type { ConnectorAdapter, ConnectorVerificationInput } from '../ports/connector-adapter.port';
import { ConnectorExecutionResult } from '../ports/connector-execution-result';
import { MockOtpChallengeStore } from './mock-otp-challenge';

@Injectable()
export class MockSmsOtpConnector implements ConnectorAdapter {
  readonly name = 'mock_sms_otp';
  readonly type = 'mock_sms_otp';

  private readonly challengeStore = new MockOtpChallengeStore(this.type);

  async verify(input: ConnectorVerificationInput): Promise<ConnectorExecutionResult> {
    if (input.declaration.method === 'generateCode') {
      const result = this.challengeStore.generateCode(
        input.execution.onboardingId,
        input.payload,
        input.declaration.config,
      );

      return this.toExecutionResult(result);
    }

    if (input.declaration.method === 'verifyCode') {
      const result = this.challengeStore.verifyCode(
        input.execution.onboardingId,
        input.payload,
        input.declaration.config,
      );

      return this.toExecutionResult(result);
    }

    return ConnectorExecutionResult.invalid();
  }

  private toExecutionResult(
    result:
      | { status: 'accepted' }
      | { status: 'invalid' }
      | {
          status: 'invalid-data';
          errors: Readonly<Record<string, readonly string[]>>;
        }
      | {
          status: 'rejected';
          reason: 'ATTEMPTS_EXHAUSTED' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND';
        },
  ) {
    if (result.status === 'accepted') {
      return ConnectorExecutionResult.accepted();
    }

    if (result.status === 'invalid') {
      return ConnectorExecutionResult.invalid();
    }

    if (result.status === 'invalid-data') {
      return ConnectorExecutionResult.invalidData(result.errors);
    }

    return ConnectorExecutionResult.rejected(result.reason);
  }

  __peekCodeForTests(onboardingId: string): string | undefined {
    return this.challengeStore.peekCodeForTests(onboardingId);
  }

  __setNowForTests(nowProvider: () => number): void {
    this.challengeStore.setNowProviderForTests(nowProvider);
  }

  __resetForTests(): void {
    this.challengeStore.resetForTests();
  }
}
