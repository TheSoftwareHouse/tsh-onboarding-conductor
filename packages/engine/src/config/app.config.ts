import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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

  @IsString()
  @IsNotEmpty()
  WORKFLOWS_DIR!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsString()
  @IsOptional()
  CLIENT_WEBHOOK_BASE_URL?: string;

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

export function validateConfig(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(AppConfig, config, { enableImplicitConversion: true });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  if (
    typeof validatedConfig.WORKFLOWS_DIR !== 'string' ||
    validatedConfig.WORKFLOWS_DIR.trim() === ''
  ) {
    throw new Error('WORKFLOWS_DIR must be a non-empty string');
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
