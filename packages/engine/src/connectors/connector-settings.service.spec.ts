import { DataSource, EntityManager } from 'typeorm';
import { ConnectorSettingsRepository } from './connector-settings.repository';
import { ConnectorSettingsService } from './connector-settings.service';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';
import { ConnectorNotConfiguredException } from './errors/connector-not-configured.exception';
import type { ConnectorAdapter } from './ports/connector-adapter.port';

const manager = {} as EntityManager;

const FAKE_TYPE = 'fake_connector';
const FAKE_DYNAMIC_TYPE = 'fake_dynamic_connector';

const fakeAdapter: ConnectorAdapter = {
  name: 'Fake Connector',
  type: FAKE_TYPE,
  settingsSchema: {
    fields: [
      { key: 'apiKey', secret: true, required: true },
      { key: 'from', secret: false, required: true },
      { key: 'optional', secret: false, required: false },
    ],
  },
  execute: jest.fn(),
};

const fakeDynamicAdapter: ConnectorAdapter = {
  name: 'Fake Dynamic Connector',
  type: FAKE_DYNAMIC_TYPE,
  settingsSchema: { fields: [], allowAdditionalKeys: true },
  execute: jest.fn(),
};

const fakeUnconfigurableAdapter: ConnectorAdapter = {
  name: 'Fake Unconfigurable Connector',
  type: 'fake_unconfigurable_connector',
  execute: jest.fn(),
};

function createRow(
  connectorType: string,
  settings: Record<string, string>,
): ConnectorSettingEntity {
  return Object.assign(new ConnectorSettingEntity(), {
    connectorType,
    settings,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedBy: 'operator@example.com',
  });
}

function createService(options?: {
  repository?: Partial<jest.Mocked<ConnectorSettingsRepository>>;
}): {
  service: ConnectorSettingsService;
  repository: jest.Mocked<ConnectorSettingsRepository>;
} {
  const repository = {
    find: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    ...options?.repository,
  } as unknown as jest.Mocked<ConnectorSettingsRepository>;

  const dataSource = { manager } as unknown as DataSource;

  const service = new ConnectorSettingsService(repository, dataSource);

  return { service, repository };
}

describe('ConnectorSettingsService', () => {
  describe('resolve', () => {
    it('resolves a stored value', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_TYPE, { apiKey: 'stored-value' }));

      const resolved = await service.resolve(fakeAdapter);

      expect(resolved.find('apiKey')).toBe('stored-value');
      expect(resolved.get('apiKey')).toBe('stored-value');
    });

    it('find returns undefined when no row is stored', async () => {
      const { service } = createService();

      const resolved = await service.resolve(fakeAdapter);

      expect(resolved.find('apiKey')).toBeUndefined();
    });

    it('get throws ConnectorNotConfiguredException when the key is unresolvable', async () => {
      const { service } = createService();

      const resolved = await service.resolve(fakeAdapter);

      expect(() => resolved.get('apiKey')).toThrow(ConnectorNotConfiguredException);
    });

    it('get throws ConnectorNotConfiguredException even when an environment variable of the old fallback name is set', async () => {
      process.env.FAKE_API_KEY = 'env-value-that-must-not-be-used';

      try {
        const { service } = createService();

        const resolved = await service.resolve(fakeAdapter);

        expect(() => resolved.get('apiKey')).toThrow(ConnectorNotConfiguredException);
        expect(resolved.find('apiKey')).toBeUndefined();
      } finally {
        delete process.env.FAKE_API_KEY;
      }
    });

    it('entries returns every stored value for a connector with undeclared keys', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_DYNAMIC_TYPE, { 'kycProvider.token': 'stored-token' }),
      );

      const resolved = await service.resolve(fakeDynamicAdapter);

      expect(resolved.entries()).toEqual({ 'kycProvider.token': 'stored-token' });
    });

    it('resolves nothing for an adapter with no settingsSchema', async () => {
      const { service } = createService();

      const resolved = await service.resolve(fakeUnconfigurableAdapter);

      expect(resolved.find('anything')).toBeUndefined();
    });
  });
});
