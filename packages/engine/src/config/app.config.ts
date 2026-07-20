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

export interface S3StorageContract {
  driver: StorageDriver.S3;
  bucket: string;
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export function resolveS3StorageContractFromConfig(configService: {
  getOrThrow: <T>(key: string) => T;
}): S3StorageContract {
  const bucket = configService.getOrThrow<string>('STORAGE_S3_BUCKET');
  const region = configService.getOrThrow<string>('STORAGE_S3_REGION');
  const endpoint = configService.getOrThrow<string>('STORAGE_S3_ENDPOINT');
  const forcePathStyle = configService.getOrThrow<boolean>('STORAGE_S3_FORCE_PATH_STYLE');
  const accessKeyId = configService.getOrThrow<string>('STORAGE_S3_ACCESS_KEY_ID');
  const secretAccessKey = configService.getOrThrow<string>('STORAGE_S3_SECRET_ACCESS_KEY');

  return resolveS3StorageContract({
    STORAGE_DRIVER: StorageDriver.S3,
    STORAGE_S3_BUCKET: bucket,
    STORAGE_S3_REGION: region,
    STORAGE_S3_ENDPOINT: endpoint,
    STORAGE_S3_FORCE_PATH_STYLE: forcePathStyle,
    STORAGE_S3_ACCESS_KEY_ID: accessKeyId,
    STORAGE_S3_SECRET_ACCESS_KEY: secretAccessKey,
  } as AppConfig);
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
