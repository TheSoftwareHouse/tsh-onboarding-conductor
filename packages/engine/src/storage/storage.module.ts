import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3ObjectStorageService } from './s3-object-storage.service';
import { OBJECT_STORAGE_PORT } from './object-storage.port';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: OBJECT_STORAGE_PORT,
      useFactory: (configService: ConfigService) => new S3ObjectStorageService(configService),
      inject: [ConfigService],
    },
  ],
  exports: [OBJECT_STORAGE_PORT],
})
export class StorageModule {}
