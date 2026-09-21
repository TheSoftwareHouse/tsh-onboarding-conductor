import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AesGcmEncryptionService } from './aes-gcm-encryption.service';
import { EncryptionAdminService } from './encryption-admin.service';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionSweepService } from './encryption-sweep.service';
import { EncryptionController } from './encryption.controller';
import { EncryptionPort } from './encryption.port';
import { setEncryptionPort } from './encryption.registry';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';
import { UnconfiguredEncryptionService } from './unconfigured-encryption.service';

/**
 * Provides the key ring (`EncryptionKeysRepository`, `EncryptionKeyRingService`), the admin
 * surface behind `/v1/admin/encryption` (`EncryptionController`, `EncryptionAdminService`), the
 * background sweep that moves `onboardings.context` toward the state the operator chose
 * (`EncryptionSweepService`), and — via this class's own `onModuleInit` — binds the application's
 * `EncryptionPort` and populates `encryption.registry.ts` so every column transformer can resolve
 * it lazily. `AuditModule` is imported directly, not assumed global, because the admin service
 * (turning encryption on or off, rotating) and the sweep both write `encryption.*` audit rows.
 * `AuthModule` is imported the same way every other admin controller's module does, so
 * `AzureJwtGuard` (behind `@AdminRoute()`) can resolve its own dependencies.
 *
 * Registered ahead of `TypeOrmModule.forRootAsync` in `AppModule.imports`, so the registry is
 * populated before any entity operation can run.
 */
@Module({
  // `forFeature` is load-bearing, not decoration: the DataSource is built with
  // `autoLoadEntities: true`, which only discovers entities a module registers here. Without it
  // `EncryptionKeyEntity` has no metadata and the ring's boot-time reload throws
  // `EntityMetadataNotFoundError` during `onModuleInit`, taking the whole engine down at startup.
  imports: [TypeOrmModule.forFeature([EncryptionKeyEntity]), AuditModule, AuthModule],
  controllers: [EncryptionController],
  providers: [
    EncryptionKeysRepository,
    EncryptionKeyRingService,
    EncryptionAdminService,
    EncryptionSweepService,
  ],
  exports: [EncryptionKeyRingService],
})
export class EncryptionModule implements OnModuleInit {
  constructor(private readonly ring: EncryptionKeyRingService) {}

  /**
   * Binds the process-wide `EncryptionPort` and populates `encryption.registry.ts`. Which
   * implementation is bound depends only on whether this process holds the key-encryption key;
   * whether a write is actually encrypted is the ring's call, per write, so an operator turning
   * encryption on or off from the admin panel needs no restart. Nest calls a module class's own
   * `onModuleInit` only after every provider in the module — including `EncryptionKeyRingService`
   * — has completed its own `onModuleInit`, so the ring's initial `reload()` has already run by
   * the time this fires.
   *
   * A module-level hook rather than a dedicated provider/token: nothing needs to inject this
   * value through Nest (see `encryption.port.ts`'s doc comment) and the ring is already a
   * constructor dependency of this module.
   */
  onModuleInit(): void {
    const port: EncryptionPort = this.ring.isKeyEncryptionKeyConfigured()
      ? new AesGcmEncryptionService(this.ring)
      : new UnconfiguredEncryptionService();

    setEncryptionPort(port);
  }
}
