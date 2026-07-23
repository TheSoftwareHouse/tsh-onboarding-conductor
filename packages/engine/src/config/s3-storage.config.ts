import { AppConfig, StorageDriver } from './app.config';

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
