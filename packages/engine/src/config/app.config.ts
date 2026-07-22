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
  CLIENT_WEBHOOK_URL?: string;

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

  validateClientWebhookConfig(validatedConfig);

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

function validateClientWebhookConfig(config: AppConfig) {
  const rawUrl = config.CLIENT_WEBHOOK_URL;
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    config.CLIENT_WEBHOOK_URL = undefined;
    return;
  }

  const normalizedUrl = rawUrl.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error('CLIENT_WEBHOOK_URL must be a valid absolute HTTP(S) URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('CLIENT_WEBHOOK_URL must use HTTP or HTTPS protocol');
  }

  if (parsedUrl.username !== '' || parsedUrl.password !== '') {
    throw new Error('CLIENT_WEBHOOK_URL must not include credentials');
  }

  if (parsedUrl.hash !== '') {
    throw new Error('CLIENT_WEBHOOK_URL must not include URL fragments');
  }

  const nodeEnv = config.NODE_ENV.toLowerCase();
  if (nodeEnv === 'production' && parsedUrl.protocol !== 'https:') {
    throw new Error('CLIENT_WEBHOOK_URL must use HTTPS in production');
  }

  if (parsedUrl.protocol === 'http:' && nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('CLIENT_WEBHOOK_URL over HTTP is allowed only in development and test');
  }

  if (parsedUrl.protocol === 'http:' && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error('CLIENT_WEBHOOK_URL over HTTP must target a loopback host');
  }

  config.CLIENT_WEBHOOK_URL = parsedUrl.toString();
}

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = normalizeHostname(hostname);

  if (normalizedHostname === 'localhost' || normalizedHostname === '::1') {
    return true;
  }

  return normalizedHostname.startsWith('127.');
}

function normalizeHostname(hostname: string) {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }

  return hostname;
}
