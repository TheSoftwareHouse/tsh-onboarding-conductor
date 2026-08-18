import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

import { validateClientWebhookUrl } from '../utils/client-webhook-url/client-webhook-url.validator';
import { validateAdminPanelOrigin } from '../utils/admin-panel/admin-panel.validator';
import { parseClientWebhookSigningSecrets } from './client-webhook-signing-secrets.config';
import { parseHttpConnectorSecrets } from './http-connector-secrets.config';

export enum AppMode {
  ALL = 'all',
  API_ONLY = 'api-only',
  WORKER_ONLY = 'worker-only',
}

export enum StorageDriver {
  S3 = 's3',
}

const CLIENT_WEBHOOK_TIMEOUT_MS_DEFAULT = 5000;
const CLIENT_WEBHOOK_TIMEOUT_MS_MIN = 100;
const CLIENT_WEBHOOK_TIMEOUT_MS_MAX = 30000;
const TWILIO_VERIFY_TIMEOUT_MS_DEFAULT = 10000;
const TWILIO_VERIFY_TIMEOUT_MS_MIN = 100;
const TWILIO_VERIFY_TIMEOUT_MS_MAX = 30000;

const SMTP_TIMEOUT_MS_DEFAULT = 5000;
const SMTP_TIMEOUT_MS_MIN = 100;
const SMTP_TIMEOUT_MS_MAX = 30000;
const SMTP_PORT_MIN = 1;
const SMTP_PORT_MAX = 65535;

const WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS_DEFAULT = 1000;
const WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS_MIN = 100;

const WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_DEFAULT = 25;
const WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_MIN = 1;
const WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_MAX = 1000;

const WEBHOOK_OUTBOX_WORKER_LEASE_MS_DEFAULT = 60000;
const WEBHOOK_OUTBOX_WORKER_LEASE_MS_MIN = 1000;
const WEBHOOK_OUTBOX_WORKER_LEASE_GRACE_MS = 5000;

const HTTP_CONNECTOR_TIMEOUT_MS_DEFAULT = 5000;
const HTTP_CONNECTOR_TIMEOUT_MS_MIN = 100;
const HTTP_CONNECTOR_TIMEOUT_MS_MAX = 30000;

const HTTP_CONNECTOR_SECRETS_DEFAULT = '{}';

const CLIENT_WEBHOOK_SIGNING_SECRETS_DEFAULT = '{}';

const WEBHOOK_OUTBOX_QUEUE_NAME_DEFAULT = 'webhook-outbox';
const WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_DEFAULT = 4;
const WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_MIN = 1;
const WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_MAX = 32;

export class AppConfig {
  @IsEnum(AppMode)
  @IsOptional()
  @Type(() => String)
  MODE: AppMode = AppMode.ALL;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  NODE_ENV: string = 'development';

  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  ADMIN_PANEL_ORIGIN!: string;

  /**
   * Production-grade workflows shipped inside the engine image. Loaded in every environment and
   * allowed to be empty — the repository ships none yet.
   */
  @IsString()
  @IsOptional()
  @Type(() => String)
  BUILTIN_WORKFLOWS_DIR: string = './workflows/built-in';

  /**
   * Operator-supplied workflows, normally a mounted volume. Loaded in every environment.
   */
  @IsString()
  @IsOptional()
  @Type(() => String)
  WORKFLOWS_DIR?: string;

  /**
   * Workflows that exist to exercise the engine. Development and test only: configuring this
   * under NODE_ENV=production is refused, the same way sandbox connectors are.
   */
  @IsString()
  @IsOptional()
  @Type(() => String)
  FIXTURE_WORKFLOWS_DIR?: string;

  /**
   * Registers the sandbox connector adapters (the mock_* types). They fake their providers and
   * must never run against real applicants, so this is refused outright when NODE_ENV=production.
   */
  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  SANDBOX_CONNECTORS_ENABLED: boolean = false;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  SMTP_ENABLED: boolean = false;

  @IsString()
  @IsOptional()
  @Type(() => String)
  SMTP_HOST?: string;

  @IsInt()
  @Min(SMTP_PORT_MIN)
  @Max(SMTP_PORT_MAX)
  @IsOptional()
  @Type(() => Number)
  SMTP_PORT?: number;

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  SMTP_SECURE: boolean = false;

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  SMTP_STARTTLS: boolean = false;

  @IsString()
  @IsOptional()
  @Type(() => String)
  SMTP_USERNAME?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  SMTP_PASSWORD?: string;

  @IsString()
  @IsEmail()
  @IsOptional()
  @Type(() => String)
  SMTP_FROM?: string;

  @IsInt()
  @Min(SMTP_TIMEOUT_MS_MIN)
  @Max(SMTP_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  SMTP_TIMEOUT_MS: number = SMTP_TIMEOUT_MS_DEFAULT;

  @IsString()
  @IsOptional()
  CLIENT_WEBHOOK_BASE_URL?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  CLIENT_WEBHOOK_SIGNING_SECRETS: string = CLIENT_WEBHOOK_SIGNING_SECRETS_DEFAULT;

  @IsInt()
  @Min(CLIENT_WEBHOOK_TIMEOUT_MS_MIN)
  @Max(CLIENT_WEBHOOK_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  CLIENT_WEBHOOK_TIMEOUT_MS: number = CLIENT_WEBHOOK_TIMEOUT_MS_DEFAULT;

  @IsInt()
  @Min(WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS_MIN)
  @IsOptional()
  @Type(() => Number)
  WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS: number = WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS_DEFAULT;

  @IsInt()
  @Min(WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_MIN)
  @Max(WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_MAX)
  @IsOptional()
  @Type(() => Number)
  WEBHOOK_OUTBOX_WORKER_BATCH_SIZE: number = WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_DEFAULT;

  @IsInt()
  @Min(WEBHOOK_OUTBOX_WORKER_LEASE_MS_MIN)
  @IsOptional()
  @Type(() => Number)
  WEBHOOK_OUTBOX_WORKER_LEASE_MS: number = WEBHOOK_OUTBOX_WORKER_LEASE_MS_DEFAULT;

  @IsString()
  @IsOptional()
  @Type(() => String)
  WEBHOOK_OUTBOX_QUEUE_NAME: string = WEBHOOK_OUTBOX_QUEUE_NAME_DEFAULT;

  @IsInt()
  @Min(WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_MIN)
  @Max(WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_MAX)
  @IsOptional()
  @Type(() => Number)
  WEBHOOK_OUTBOX_QUEUE_CONCURRENCY: number = WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_DEFAULT;
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  @TransformTrimString()
  TWILIO_ACCOUNT_SID!: string;

  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  @TransformTrimString()
  TWILIO_AUTH_TOKEN!: string;

  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  @TransformTrimString()
  @Matches(/^VA[A-Za-z0-9]+$/)
  TWILIO_VERIFY_SERVICE_SID!: string;

  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  @TransformTrimString()
  SENDGRID_API_KEY!: string;

  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  @TransformTrimString()
  @IsEmail()
  SENDGRID_FROM!: string;

  @IsInt()
  @Min(TWILIO_VERIFY_TIMEOUT_MS_MIN)
  @Max(TWILIO_VERIFY_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  TWILIO_VERIFY_TIMEOUT_MS: number = TWILIO_VERIFY_TIMEOUT_MS_DEFAULT;

  @IsInt()
  @Min(HTTP_CONNECTOR_TIMEOUT_MS_MIN)
  @Max(HTTP_CONNECTOR_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  HTTP_CONNECTOR_TIMEOUT_MS: number = HTTP_CONNECTOR_TIMEOUT_MS_DEFAULT;

  @IsString()
  @IsOptional()
  @Type(() => String)
  HTTP_CONNECTOR_SECRETS: string = HTTP_CONNECTOR_SECRETS_DEFAULT;

  @IsEnum(StorageDriver)
  @IsOptional()
  @Type(() => String)
  STORAGE_DRIVER: StorageDriver = StorageDriver.S3;

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_BUCKET: string = 'orchestrator-files';

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_REGION: string = 'us-east-1';

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_ENDPOINT: string = 'http://minio:9000';

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  STORAGE_S3_FORCE_PATH_STYLE: boolean = true;

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_SECRET_ACCESS_KEY!: string;
}

/**
 * A workflow source that is present but blank is a configuration mistake rather than an
 * intentional opt-out, so it is rejected instead of being silently treated as unset.
 */
function normalizeWorkflowsDir(key: string, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} must be a non-empty string when set`);
  }

  return value.trim();
}

export function validateConfig(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(AppConfig, config, { enableImplicitConversion: true });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  validatedConfig.BUILTIN_WORKFLOWS_DIR = normalizeWorkflowsDir(
    'BUILTIN_WORKFLOWS_DIR',
    validatedConfig.BUILTIN_WORKFLOWS_DIR,
  );
  validatedConfig.WORKFLOWS_DIR = normalizeWorkflowsDir(
    'WORKFLOWS_DIR',
    validatedConfig.WORKFLOWS_DIR,
  );
  validatedConfig.FIXTURE_WORKFLOWS_DIR = normalizeWorkflowsDir(
    'FIXTURE_WORKFLOWS_DIR',
    validatedConfig.FIXTURE_WORKFLOWS_DIR,
  );

  if (validatedConfig.FIXTURE_WORKFLOWS_DIR && validatedConfig.NODE_ENV === 'production') {
    throw new Error('FIXTURE_WORKFLOWS_DIR must not be configured when NODE_ENV=production');
  }

  if (validatedConfig.SANDBOX_CONNECTORS_ENABLED && validatedConfig.NODE_ENV === 'production') {
    throw new Error('SANDBOX_CONNECTORS_ENABLED must not be enabled when NODE_ENV=production');
  }

  if (
    typeof validatedConfig.WEBHOOK_OUTBOX_QUEUE_NAME !== 'string' ||
    validatedConfig.WEBHOOK_OUTBOX_QUEUE_NAME.trim() === ''
  ) {
    throw new Error('WEBHOOK_OUTBOX_QUEUE_NAME must be a non-empty string');
  }

  validatedConfig.WEBHOOK_OUTBOX_QUEUE_NAME = validatedConfig.WEBHOOK_OUTBOX_QUEUE_NAME.trim();

  validatedConfig.CLIENT_WEBHOOK_BASE_URL = validateClientWebhookUrl(
    validatedConfig.CLIENT_WEBHOOK_BASE_URL,
    validatedConfig.NODE_ENV,
  );

  validatedConfig.ADMIN_PANEL_ORIGIN = validateAdminPanelOrigin(validatedConfig.ADMIN_PANEL_ORIGIN);

  parseHttpConnectorSecrets(validatedConfig.HTTP_CONNECTOR_SECRETS);

  const clientWebhookSigningSecrets = parseClientWebhookSigningSecrets(
    validatedConfig.CLIENT_WEBHOOK_SIGNING_SECRETS,
  );

  if (validatedConfig.CLIENT_WEBHOOK_BASE_URL && clientWebhookSigningSecrets.length === 0) {
    throw new Error(
      'CLIENT_WEBHOOK_SIGNING_SECRETS is required when CLIENT_WEBHOOK_BASE_URL is configured',
    );
  }

  if (validatedConfig.SMTP_ENABLED) {
    const smtpHost = validatedConfig.SMTP_HOST?.trim();
    if (!smtpHost) {
      throw new Error('SMTP_HOST is required when SMTP_ENABLED=true');
    }

    if (
      typeof validatedConfig.SMTP_PORT !== 'number' ||
      !Number.isInteger(validatedConfig.SMTP_PORT)
    ) {
      throw new Error('SMTP_PORT is required when SMTP_ENABLED=true');
    }

    if (typeof validatedConfig.SMTP_FROM !== 'string' || validatedConfig.SMTP_FROM.trim() === '') {
      throw new Error('SMTP_FROM is required when SMTP_ENABLED=true');
    }

    if (
      typeof validatedConfig.SMTP_TIMEOUT_MS !== 'number' ||
      !Number.isInteger(validatedConfig.SMTP_TIMEOUT_MS)
    ) {
      throw new Error('SMTP_TIMEOUT_MS is required when SMTP_ENABLED=true');
    }

    if (validatedConfig.SMTP_SECURE && validatedConfig.SMTP_STARTTLS) {
      throw new Error('SMTP_SECURE and SMTP_STARTTLS cannot both be true');
    }

    if (!validatedConfig.SMTP_SECURE && !validatedConfig.SMTP_STARTTLS) {
      const normalizedHost = smtpHost.toLowerCase();
      if (normalizedHost !== 'mailhog') {
        throw new Error(
          'SMTP_SECURE=false and SMTP_STARTTLS=false are only allowed for the mailhog target',
        );
      }
    }

    const hasUsername =
      typeof validatedConfig.SMTP_USERNAME === 'string' &&
      validatedConfig.SMTP_USERNAME.trim() !== '';
    const hasPassword =
      typeof validatedConfig.SMTP_PASSWORD === 'string' &&
      validatedConfig.SMTP_PASSWORD.trim() !== '';

    if (hasUsername !== hasPassword) {
      throw new Error('SMTP_USERNAME and SMTP_PASSWORD must be provided together');
    }
  }

  if (
    validatedConfig.WEBHOOK_OUTBOX_WORKER_LEASE_MS <
    validatedConfig.CLIENT_WEBHOOK_TIMEOUT_MS + WEBHOOK_OUTBOX_WORKER_LEASE_GRACE_MS
  ) {
    throw new Error(
      'WEBHOOK_OUTBOX_WORKER_LEASE_MS must be at least CLIENT_WEBHOOK_TIMEOUT_MS + 5000 ms',
    );
  }

  return validatedConfig;
}

function TransformBooleanString() {
  return Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return value;
  });
}

function TransformTrimString() {
  return Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }

    return value;
  });
}
