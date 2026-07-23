import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
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
  @IsNotEmpty()
  WORKFLOWS_DIR!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

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
