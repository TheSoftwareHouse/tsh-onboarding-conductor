import { plainToInstance, Type } from 'class-transformer';
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
  @Type(() => Boolean)
  STORAGE_S3_FORCE_PATH_STYLE: boolean = true;

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_SECRET_ACCESS_KEY!: string;

  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  ENGINE_SERVICE_SECRET!: string;
}

export interface S3StorageContract {
  driver: StorageDriver.S3;
  bucket: string;
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export function resolveS3StorageContract(config: AppConfig): S3StorageContract {
  return {
    driver: config.STORAGE_DRIVER,
    bucket: config.STORAGE_S3_BUCKET,
    region: config.STORAGE_S3_REGION,
    endpoint: config.STORAGE_S3_ENDPOINT,
    forcePathStyle: config.STORAGE_S3_FORCE_PATH_STYLE,
    accessKeyId: config.STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: config.STORAGE_S3_SECRET_ACCESS_KEY,
  };
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
