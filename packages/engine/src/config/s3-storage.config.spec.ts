import 'reflect-metadata';
import { StorageDriver } from './app.config';
import { resolveS3StorageContractFromConfig } from './s3-storage.config';

describe('resolveS3StorageContractFromConfig', () => {
  it('maps the six S3 config values to the S3 storage contract', () => {
    const configService = {
      getOrThrow: <T>(key: string) => {
        const values: Record<string, unknown> = {
          STORAGE_S3_BUCKET: 'bucket',
          STORAGE_S3_REGION: 'us-east-1',
          STORAGE_S3_ENDPOINT: 'http://localhost:9000',
          STORAGE_S3_FORCE_PATH_STYLE: false,
          STORAGE_S3_ACCESS_KEY_ID: 'access',
          STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
        };

        return values[key] as T;
      },
    };

    expect(resolveS3StorageContractFromConfig(configService)).toEqual({
      driver: StorageDriver.S3,
      bucket: 'bucket',
      region: 'us-east-1',
      endpoint: 'http://localhost:9000',
      forcePathStyle: false,
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    });
  });
});
