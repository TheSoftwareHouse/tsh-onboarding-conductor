export const MOCK_OTP_OPERATION = {
  VERIFY: 'verify',
  GENERATE_CODE: 'generateCode',
  VERIFY_CODE: 'verifyCode',
} as const;

export type MockOtpOperation = (typeof MOCK_OTP_OPERATION)[keyof typeof MOCK_OTP_OPERATION];

type GenerateCodeOperation = {
  operation: typeof MOCK_OTP_OPERATION.GENERATE_CODE;
  codeLength: number;
  ttlSeconds: number;
};

type VerifyCodeOperation = {
  operation: typeof MOCK_OTP_OPERATION.VERIFY_CODE;
  maxAttempts: number;
};

export type ResolvedMockOtpOperation =
  { operation: typeof MOCK_OTP_OPERATION.VERIFY } | GenerateCodeOperation | VerifyCodeOperation;

const isPositiveInteger = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
};

export const resolveMockOtpOperation = (
  config: Readonly<Record<string, unknown>>,
): ResolvedMockOtpOperation | undefined => {
  const operation = config.operation;

  if (operation === MOCK_OTP_OPERATION.VERIFY) {
    return { operation };
  }

  if (operation === MOCK_OTP_OPERATION.GENERATE_CODE) {
    if (!isPositiveInteger(config.codeLength) || !isPositiveInteger(config.ttlSeconds)) {
      return undefined;
    }

    return {
      operation,
      codeLength: config.codeLength,
      ttlSeconds: config.ttlSeconds,
    };
  }

  if (operation === MOCK_OTP_OPERATION.VERIFY_CODE) {
    if (!isPositiveInteger(config.maxAttempts)) {
      return undefined;
    }

    return {
      operation,
      maxAttempts: config.maxAttempts,
    };
  }

  return undefined;
};
