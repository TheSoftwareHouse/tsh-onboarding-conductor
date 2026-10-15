/** Algoan API paths and constants shared by the client and, later, the provider. */
export const ALGOAN_TOKEN_PATH = '/v1/oauth/token';
export const ALGOAN_GRANT_TYPE_CLIENT_CREDENTIALS = 'client_credentials';

/** A cached token is dropped this long before Algoan says it expires. */
export const ALGOAN_TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Algoan's code for a `customIdentifier` already in use (HTTP 422). */
export const ALGOAN_CODE_ALREADY_EXISTS = 'ALREADY_EXISTS';

export const ALGOAN_ANALYSIS_STATUS = {
  CREATED: 'CREATED',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
} as const;

/** `/credit-insights/{kind}` sections. */
export const ALGOAN_CREDIT_INSIGHT_KINDS = [
  'incomes',
  'expenses',
  'loans',
  'risks',
  'cash-flows',
] as const;

export type AlgoanCreditInsightKind = (typeof ALGOAN_CREDIT_INSIGHT_KINDS)[number];

export type AlgoanCredentials = Readonly<{ clientId: string; clientSecret: string }>;

export type AlgoanCustomer = Readonly<{ id: string; customIdentifier: string }>;

export type AlgoanAnalysisRequest = Readonly<Record<string, unknown>>;

export type AlgoanAnalysis = Readonly<{
  id: string;
  status: string;
  scores?: Readonly<Record<string, unknown>>;
  creditInsights?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, unknown>>;
  error?: Readonly<{ code?: string; message?: string }>;
}>;

export type AlgoanPage = Readonly<{
  resources: readonly Record<string, unknown>[];
  pagination: Readonly<Record<string, unknown>>;
  hasNext: boolean;
}>;
