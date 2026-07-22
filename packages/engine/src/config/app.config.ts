import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

import { validateClientWebhookUrl } from '../utils/client-webhook-url/client-webhook-url.validator';

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
  @IsOptional()
  @Type(() => String)
  ADMIN_PANEL_ORIGIN: string = 'http://localhost:5173';

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

  validatedConfig.CLIENT_WEBHOOK_BASE_URL = validateClientWebhookUrl(
    validatedConfig.CLIENT_WEBHOOK_BASE_URL,
    validatedConfig.NODE_ENV,
  );

  const adminPanelOrigin = validatedConfig.ADMIN_PANEL_ORIGIN?.trim();

  if (adminPanelOrigin === '') {
    throw new Error('ADMIN_PANEL_ORIGIN must be a non-empty absolute http(s) origin');
  }

  if (typeof adminPanelOrigin === 'string') {
    try {
      const parsedOrigin = new URL(adminPanelOrigin);

      if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
        throw new Error();
      }

      if (parsedOrigin.username || parsedOrigin.password) {
        throw new Error();
      }

      if (parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) {
        throw new Error();
      }

      if (adminPanelOrigin.endsWith('/')) {
        throw new Error();
      }
    } catch {
      throw new Error(
        'ADMIN_PANEL_ORIGIN must be an absolute http(s) origin without a path, query, fragment, credentials, or trailing slash',
      );
    }
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
