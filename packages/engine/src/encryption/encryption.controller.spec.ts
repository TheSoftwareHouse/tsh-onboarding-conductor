import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AzureJwtGuard } from '../auth/azure-jwt.guard';
import type { EncryptionAdminService, EncryptionKeysView } from './encryption-admin.service';
import { EncryptionController } from './encryption.controller';

const createServiceStub = (): jest.Mocked<EncryptionAdminService> =>
  ({
    listKeys: jest.fn(),
    addKey: jest.fn(),
  }) as unknown as jest.Mocked<EncryptionAdminService>;

const createRequest = (claims?: Record<string, unknown>) =>
  ({ adminTokenClaims: claims }) as unknown as Request & {
    adminTokenClaims?: Record<string, unknown>;
  };

const buildView = (overrides: Partial<EncryptionKeysView> = {}): EncryptionKeysView => ({
  keys: [
    {
      id: 'key-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      createdBy: null,
      activatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      active: true,
      pendingActivation: false,
    },
  ],
  reEncryption: { pending: 0, total: 5 },
  ...overrides,
});

describe('EncryptionController', () => {
  it('carries AzureJwtGuard on every route', () => {
    for (const method of ['list', 'add'] as const) {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        EncryptionController.prototype[method],
      ) as unknown[] | undefined;

      expect(guards).toEqual([AzureJwtGuard]);
    }
  });

  describe('list', () => {
    it('maps the key history and progress to the response shape, serializing dates', async () => {
      const service = createServiceStub();
      service.listKeys.mockResolvedValue(buildView());
      const controller = new EncryptionController(service);

      const response = await controller.list();

      expect(response).toEqual({
        keys: [
          {
            id: 'key-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            createdBy: null,
            activatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            active: true,
            pendingActivation: false,
          },
        ],
        reEncryption: { pending: 0, total: 5 },
      });
    });

    it('never includes wrappedKey or any other unmapped field', async () => {
      const service = createServiceStub();
      service.listKeys.mockResolvedValue(buildView());
      const controller = new EncryptionController(service);

      const response = await controller.list();

      expect(JSON.stringify(response)).not.toContain('wrapped');
    });
  });

  describe('add', () => {
    it('rotates under the operator behind the token and returns only the new key id', async () => {
      const service = createServiceStub();
      service.addKey.mockResolvedValue({ id: 'key-new' });
      const controller = new EncryptionController(service);

      const response = await controller.add(createRequest({ oid: 'operator-oid' }));

      expect(service.addKey).toHaveBeenCalledWith('operator-oid');
      expect(response).toEqual({ id: 'key-new' });
    });

    it('falls back to the unknown-actor constant with no token claims', async () => {
      const service = createServiceStub();
      service.addKey.mockResolvedValue({ id: 'key-new' });
      const controller = new EncryptionController(service);

      await controller.add(createRequest(undefined));

      expect(service.addKey).toHaveBeenCalledWith(ADMIN_ACCESS_UNKNOWN_ACTOR);
    });
  });
});
