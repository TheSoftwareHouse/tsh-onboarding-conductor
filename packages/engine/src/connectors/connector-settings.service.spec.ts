import { DataSource, EntityManager } from 'typeorm';
import { ConnectorsRepository } from './connectors.repository';
import { ConnectorSettingsService } from './connector-settings.service';
import { ConnectorEntity } from './entity/connector.entity';
import { ConnectorNotConfiguredException } from './errors/connector-not-configured.exception';
import type { ConnectorAdapter } from './ports/connector-adapter.port';

const manager = {} as EntityManager;

const FAKE_ID = 'fake_connector';

const fakeAdapter: ConnectorAdapter = {
  name: 'Fake Connector',
  id: FAKE_ID,
  type: 'custom',
  settingsSchema: {
    fields: [
      { key: 'apiKey', secret: true, required: true },
      { key: 'from', secret: false, required: true },
      { key: 'optional', secret: false, required: false },
    ],
  },
  execute: jest.fn(),
};

const fakeUnconfigurableAdapter: ConnectorAdapter = {
  name: 'Fake Unconfigurable Connector',
  id: 'fake_unconfigurable_connector',
  type: 'custom',
  execute: jest.fn(),
};

function createRow(id: string, settings: Record<string, string>): ConnectorEntity {
  return Object.assign(new ConnectorEntity(), {
    id,
    type: 'custom',
    settings,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedBy: 'operator@example.com',
  });
}

function createService(options?: { repository?: Partial<jest.Mocked<ConnectorsRepository>> }): {
  service: ConnectorSettingsService;
  repository: jest.Mocked<ConnectorsRepository>;
} {
  const repository = {
    lock: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    ...options?.repository,
  } as unknown as jest.Mocked<ConnectorsRepository>;

  const dataSource = { manager } as unknown as DataSource;

  const service = new ConnectorSettingsService(repository, dataSource);

  return { service, repository };
}

describe('ConnectorSettingsService', () => {
  describe('resolve', () => {
    it('resolves a stored value', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_ID, { apiKey: 'stored-value' }));

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

    it('resolves nothing for an adapter with no settingsSchema', async () => {
      const { service } = createService();

      const resolved = await service.resolve(fakeUnconfigurableAdapter);

      expect(resolved.find('anything')).toBeUndefined();
    });
  });
});
