import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AzureJwtGuard } from '../auth/azure-jwt.guard';
import type { EncryptionAdminService, EncryptionStateView } from './encryption-admin.service';
import { EncryptionController } from './encryption.controller';

const createServiceStub = (): jest.Mocked<EncryptionAdminService> =>
  ({
    getState: jest.fn(),
    setEnabled: jest.fn(),
    setRotationInterval: jest.fn(),
    addKey: jest.fn(),
  }) as unknown as jest.Mocked<EncryptionAdminService>;

const createRequest = (claims?: Record<string, unknown>) =>
  ({ adminTokenClaims: claims }) as unknown as Request & {
    adminTokenClaims?: Record<string, unknown>;
  };

const buildView = (overrides: Partial<EncryptionStateView> = {}): EncryptionStateView => ({
  enabled: true,
  keyConfigured: true,
  keys: [
    {
      id: 'key-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      createdBy: 'operator-oid',
      activatedAt: new Date('2026-01-01T00:00:15.000Z'),
      deletedAt: null,
      active: true,
      pendingActivation: false,
    },
  ],
  rotation: { interval: '1w', nextRotationAt: new Date('2026-01-08T00:00:00.000Z') },
  progress: { pending: 0, total: 5 },
  ...overrides,
});

const serializedView = {
  enabled: true,
  keyConfigured: true,
  keys: [
    {
      id: 'key-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'operator-oid',
      activatedAt: '2026-01-01T00:00:15.000Z',
      deletedAt: null,
      active: true,
      pendingActivation: false,
    },
  ],
  rotation: { interval: '1w', nextRotationAt: '2026-01-08T00:00:00.000Z' },
  progress: { pending: 0, total: 5 },
};

describe('EncryptionController', () => {
  it('carries AzureJwtGuard on every route', () => {
    for (const method of ['getState', 'setEnabled', 'setRotation', 'addKey'] as const) {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        EncryptionController.prototype[method],
      ) as unknown[] | undefined;

      expect(guards).toEqual([AzureJwtGuard]);
    }
  });

  describe('getState', () => {
    it('maps the state, key history and progress to the response shape, serializing dates', async () => {
      const service = createServiceStub();
      service.getState.mockResolvedValue(buildView());
      const controller = new EncryptionController(service);

      await expect(controller.getState()).resolves.toEqual(serializedView);
    });

    it('never includes wrappedKey or any other unmapped field', async () => {
      const service = createServiceStub();
      service.getState.mockResolvedValue(buildView());
      const controller = new EncryptionController(service);

      const response = await controller.getState();

      expect(JSON.stringify(response)).not.toContain('wrapped');
    });
  });

  describe('setEnabled', () => {
    it('passes the requested state and the operator behind the token, and returns the new state', async () => {
      const service = createServiceStub();
      service.setEnabled.mockResolvedValue(buildView({ enabled: false }));
      const controller = new EncryptionController(service);

      const response = await controller.setEnabled(
        { enabled: false },
        createRequest({ oid: 'operator-oid' }),
      );

      expect(service.setEnabled).toHaveBeenCalledWith(false, 'operator-oid');
      expect(response).toEqual({ ...serializedView, enabled: false });
    });

    it('falls back to the unknown-actor constant with no token claims', async () => {
      const service = createServiceStub();
      service.setEnabled.mockResolvedValue(buildView());
      const controller = new EncryptionController(service);

      await controller.setEnabled({ enabled: true }, createRequest(undefined));

      expect(service.setEnabled).toHaveBeenCalledWith(true, ADMIN_ACCESS_UNKNOWN_ACTOR);
    });
  });

  describe('setRotation', () => {
    it('passes the chosen interval and the operator behind the token, and returns the new state', async () => {
      const service = createServiceStub();
      service.setRotationInterval.mockResolvedValue(
        buildView({
          rotation: { interval: '48h', nextRotationAt: new Date('2026-01-03T00:00:00.000Z') },
        }),
      );
      const controller = new EncryptionController(service);

      const response = await controller.setRotation(
        { interval: '48h' },
        createRequest({ oid: 'operator-oid' }),
      );

      expect(service.setRotationInterval).toHaveBeenCalledWith('48h', 'operator-oid');
      expect(response).toEqual({
        ...serializedView,
        rotation: { interval: '48h', nextRotationAt: '2026-01-03T00:00:00.000Z' },
      });
    });

    it('carries a null interval through as the request to stop rotating automatically', async () => {
      const service = createServiceStub();
      service.setRotationInterval.mockResolvedValue(
        buildView({ rotation: { interval: null, nextRotationAt: null } }),
      );
      const controller = new EncryptionController(service);

      const response = await controller.setRotation({ interval: null }, createRequest(undefined));

      expect(service.setRotationInterval).toHaveBeenCalledWith(null, ADMIN_ACCESS_UNKNOWN_ACTOR);
      expect(response.rotation).toEqual({ interval: null, nextRotationAt: null });
    });
  });

  describe('addKey', () => {
    it('rotates under the operator behind the token and returns only the new key id', async () => {
      const service = createServiceStub();
      service.addKey.mockResolvedValue({ id: 'key-new' });
      const controller = new EncryptionController(service);

      const response = await controller.addKey(createRequest({ oid: 'operator-oid' }));

      expect(service.addKey).toHaveBeenCalledWith('operator-oid');
      expect(response).toEqual({ id: 'key-new' });
    });

    it('falls back to the unknown-actor constant with no token claims', async () => {
      const service = createServiceStub();
      service.addKey.mockResolvedValue({ id: 'key-new' });
      const controller = new EncryptionController(service);

      await controller.addKey(createRequest(undefined));

      expect(service.addKey).toHaveBeenCalledWith(ADMIN_ACCESS_UNKNOWN_ACTOR);
    });
  });
});
