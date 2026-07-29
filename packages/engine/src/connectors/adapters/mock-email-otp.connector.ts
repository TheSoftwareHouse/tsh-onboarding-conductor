import { Injectable } from '@nestjs/common';
import type { ConnectorAdapter, ConnectorVerificationInput } from '../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../ports/connector-execution-result';
import { MockOtpChallengeStore } from './mock-otp-challenge';
import { MOCK_OTP_OPERATION, resolveMockOtpOperation } from './mock-otp-operation';

@Injectable()
export class MockEmailOtpConnector implements ConnectorAdapter {
  readonly name = 'mock_email_otp';
  readonly type = 'mock_email_otp';

  private readonly challengeStore = new MockOtpChallengeStore(this.type);

  async verify(input: ConnectorVerificationInput): Promise<ConnectorExecutionResult> {
    const resolvedOperation = resolveMockOtpOperation(input.declaration.config);

    if (resolvedOperation?.operation === MOCK_OTP_OPERATION.GENERATE_CODE) {
      const result = this.challengeStore.generateCode(input.execution.onboardingId, input.payload, {
        operation: resolvedOperation.operation,
        codeLength: resolvedOperation.codeLength,
        ttlSeconds: resolvedOperation.ttlSeconds,
      });

      return this.toExecutionResult(result);
    }

    if (resolvedOperation?.operation === MOCK_OTP_OPERATION.VERIFY_CODE) {
      const result = this.challengeStore.verifyCode(input.execution.onboardingId, input.payload, {
        operation: resolvedOperation.operation,
        maxAttempts: resolvedOperation.maxAttempts,
      });

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
      return ConnectorExecutionResult.invalidData(result.errors, {
        [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
      });
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
