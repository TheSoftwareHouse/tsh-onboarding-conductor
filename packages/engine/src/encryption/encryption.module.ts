import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AppConfig } from '../config/app.config';
import { AesGcmEncryptionService } from './aes-gcm-encryption.service';
import { DisabledEncryptionService } from './disabled-encryption.service';
import { EncryptionAdminService } from './encryption-admin.service';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionController } from './encryption.controller';
import { EncryptionPort } from './encryption.port';
import { setEncryptionPort } from './encryption.registry';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';
import { ReEncryptionService } from './re-encryption.service';

/**
 * Provides the key ring (`EncryptionKeysRepository`, `EncryptionKeyRingService`), the admin
 * surface behind `/v1/admin/encryption/keys` (`EncryptionController`, `EncryptionAdminService`),
 * the background sweep that moves `onboardings.context` onto a newly rotated key
 * (`ReEncryptionService`), and — via this class's own `onModuleInit` — binds the application's
 * `EncryptionPort` and populates `encryption.registry.ts` so every column transformer can resolve
 * it lazily. `AuditModule` is imported directly, not assumed global, because the ring (first-boot
 * provisioning), the admin service (key rotation) and the sweep all write `encryption.*` audit
 * rows. `AuthModule` is imported the same way every other admin controller's module does, so
 * `AzureJwtGuard` (behind `@AdminRoute()`) can resolve its own dependencies.
 *
 * Registered ahead of `TypeOrmModule.forRootAsync` in `AppModule.imports`, so the registry is
 * populated before any entity operation can run.
 */
@Module({
  // `forFeature` is load-bearing, not decoration: the DataSource is built with
  // `autoLoadEntities: true`, which only discovers entities a module registers here. Without it
  // `EncryptionKeyEntity` has no metadata and the ring's first-boot provisioning throws
  // `EntityMetadataNotFoundError` during `onModuleInit`, taking the whole engine down at startup.
  imports: [TypeOrmModule.forFeature([EncryptionKeyEntity]), AuditModule, AuthModule],
  controllers: [EncryptionController],
  providers: [
    EncryptionKeysRepository,
    EncryptionKeyRingService,
    EncryptionAdminService,
    ReEncryptionService,
  ],
  exports: [EncryptionKeyRingService],
})
export class EncryptionModule implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly ring: EncryptionKeyRingService,
  ) {}

  /**
   * Binds the process-wide `EncryptionPort` from `ENCRYPTION_ENABLED` and this module's own key
   * ring, and populates `encryption.registry.ts` so every column transformer can resolve it
   * lazily. Nest calls a module class's own `onModuleInit` only after every provider in the
   * module — including `EncryptionKeyRingService` — has completed its own `onModuleInit`, so the
   * ring's first-boot provisioning and initial `reload()` have already run by the time this
   * fires. That ordering is not required for correctness (`AesGcmEncryptionService` holds a
   * reference to the live ring and resolves keys lazily, per call, never at construction), but it
   * does mean the port is bound only once the ring is actually ready.
   *
   * A module-level hook rather than a dedicated provider/token: nothing needs to inject this
   * value through Nest (see `encryption.port.ts`'s doc comment) and the ring is already a
   * constructor dependency of this module, so a further DI token would exist solely to be that
   * side effect — the same dead surface this refactor removes `ENCRYPTION_PORT` for.
   */
  onModuleInit(): void {
    const enabled = this.configService.get('ENCRYPTION_ENABLED', { infer: true });
    const port: EncryptionPort = enabled
      ? new AesGcmEncryptionService(this.ring)
      : new DisabledEncryptionService();

    setEncryptionPort(port);
  }
}
