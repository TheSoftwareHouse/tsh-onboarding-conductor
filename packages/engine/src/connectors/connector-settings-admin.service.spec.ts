import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { ConnectorSettingsAdminService } from './connector-settings-admin.service';
import { ConnectorSettingsRepository } from './connector-settings.repository';
import { ConnectorSettingsService } from './connector-settings.service';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';
import { ConnectorSettingsInvalidException } from './errors/connector-settings-invalid.exception';
import { ConnectorTypeNotFoundException } from './errors/connector-type-not-found.exception';
import type { ConnectorAdapter } from './ports/connector-adapter.port';

const manager = {} as EntityManager;

const FAKE_TYPE = 'fake_connector';
const FAKE_DYNAMIC_TYPE = 'fake_dynamic_connector';
const FAKE_UNCONFIGURABLE_TYPE = 'fake_unconfigurable_connector';
const FAKE_PATTERNED_TYPE = 'fake_patterned_connector';

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
  type: FAKE_UNCONFIGURABLE_TYPE,
  execute: jest.fn(),
};

/** Carries a `pattern` on its one field, so the merge path's per-value pattern check
 * has something to fail against without disturbing `fakeAdapter`'s other tests. */
const fakePatternedAdapter: ConnectorAdapter = {
  name: 'Fake Patterned Connector',
  type: FAKE_PATTERNED_TYPE,
  settingsSchema: {
    fields: [{ key: 'email', secret: false, required: false, pattern: /^\S+@\S+$/ }],
  },
  execute: jest.fn(),
};

/** Same type string and schema shape as the real `SmtpConnector` — the pairing rule is
 * keyed on the literal connector type `'smtp'`, not on the fake adapter's identity. */
const fakeSmtpAdapter: ConnectorAdapter = {
  name: 'SmtpConnector',
  type: 'smtp',
  settingsSchema: {
    fields: [
      { key: 'username', secret: false, required: false },
      { key: 'password', secret: true, required: false },
    ],
  },
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
  service: ConnectorSettingsAdminService;
  repository: jest.Mocked<ConnectorSettingsRepository>;
  auditService: jest.Mocked<Pick<AuditService, 'logConnectorSettingsChange'>>;
} {
  const repository = {
    find: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    ...options?.repository,
  } as unknown as jest.Mocked<ConnectorSettingsRepository>;

  const dataSource = { manager } as unknown as DataSource;
  const connectorSettingsService = new ConnectorSettingsService(repository, dataSource);
  const auditService = {
    logConnectorSettingsChange: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<AuditService, 'logConnectorSettingsChange'>>;

  const service = new ConnectorSettingsAdminService(
    connectorSettingsService,
    [
      fakeAdapter,
      fakeDynamicAdapter,
      fakeUnconfigurableAdapter,
      fakePatternedAdapter,
      fakeSmtpAdapter,
    ],
    auditService as unknown as AuditService,
    dataSource,
  );

  return { service, repository, auditService };
}

describe('ConnectorSettingsAdminService', () => {
  describe('findSettings / listSettings', () => {
    it('never includes a secret value in the response model', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_TYPE, { apiKey: 'super-secret' }));

      const view = await service.findSettings(FAKE_TYPE);
      const apiKeySetting = view.settings.find((setting) => setting.key === 'apiKey');

      expect(apiKeySetting?.secret).toBe(true);
      expect(apiKeySetting?.source).toBe('stored');
      expect(apiKeySetting?.value).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain('super-secret');
    });

    it('reports source as stored or unset per key', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_TYPE, { apiKey: 'stored-key', from: 'stored-from' }),
      );

      const view = await service.findSettings(FAKE_TYPE);

      expect(view.settings.find((setting) => setting.key === 'apiKey')?.source).toBe('stored');
      expect(view.settings.find((setting) => setting.key === 'from')?.source).toBe('stored');
      expect(view.settings.find((setting) => setting.key === 'from')?.value).toBe('stored-from');
      expect(view.settings.find((setting) => setting.key === 'optional')?.source).toBe('unset');
      expect(view.configured).toBe(true);
    });

    it('reports configured false when a required key is unresolvable', async () => {
      const { service } = createService();

      const view = await service.findSettings(FAKE_TYPE);

      expect(view.configured).toBe(false);
    });

    it('includes undeclared stored keys as secret settings for allowAdditionalKeys connectors', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_DYNAMIC_TYPE, { 'kycProvider.token': 'stored-token' }),
      );

      const view = await service.findSettings(FAKE_DYNAMIC_TYPE);

      expect(view.settings).toEqual([
        { key: 'kycProvider.token', secret: true, required: false, source: 'stored' },
      ]);
    });

    it('reports allowAdditionalKeys true for a schema that sets it and false for one that omits it', async () => {
      const { service } = createService();

      const staticView = await service.findSettings(FAKE_TYPE);
      const dynamicView = await service.findSettings(FAKE_DYNAMIC_TYPE);

      expect(staticView.allowAdditionalKeys).toBe(false);
      expect(dynamicView.allowAdditionalKeys).toBe(true);
    });

    it('throws ConnectorTypeNotFoundException for an unknown connector type', async () => {
      const { service } = createService();

      await expect(service.findSettings('unregistered_connector')).rejects.toThrow(
        ConnectorTypeNotFoundException,
      );
    });

    it('throws ConnectorTypeNotFoundException for a connector with no settingsSchema', async () => {
      const { service } = createService();

      await expect(service.findSettings(FAKE_UNCONFIGURABLE_TYPE)).rejects.toThrow(
        ConnectorTypeNotFoundException,
      );
    });

    it('lists only connectors that declare a settingsSchema', async () => {
      const { service } = createService();

      const views = await service.listSettings();

      expect(views.map((view) => view.type)).toEqual([
        FAKE_TYPE,
        FAKE_DYNAMIC_TYPE,
        FAKE_PATTERNED_TYPE,
        'smtp',
      ]);
    });
  });

  describe('replaceSettings', () => {
    it('stores validated settings and rejects an undeclared key', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_TYPE, { apiKey: 'a', from: 'b', bogus: 'c' }, 'operator'),
      ).rejects.toThrow(ConnectorSettingsInvalidException);
    });

    it('collects every offending key in a single exception', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_TYPE, { apiKey: 1, from: '', bogus: 'x' }, 'operator'),
      ).rejects.toMatchObject({
        response: {
          issues: expect.arrayContaining([
            { key: 'apiKey', reason: 'invalid_value' },
            { key: 'from', reason: 'invalid_value' },
            { key: 'bogus', reason: 'undeclared_key' },
          ]),
        },
      });
    });

    it('rejects a required key missing from the submitted map', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_TYPE, { apiKey: 'a' }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'from', reason: 'missing_required_key' }] },
      });
    });

    it('rejects a non-string value', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_TYPE, { apiKey: 'a', from: 42 }, 'operator'),
      ).rejects.toMatchObject({
        response: {
          issues: expect.arrayContaining([{ key: 'from', reason: 'invalid_value' }]),
        },
      });
    });

    it('rejects an empty-string value', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_TYPE, { apiKey: 'a', from: '' }, 'operator'),
      ).rejects.toMatchObject({
        response: {
          issues: expect.arrayContaining([{ key: 'from', reason: 'invalid_value' }]),
        },
      });
    });

    it('accepts an undeclared key when the schema allows additional keys', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_DYNAMIC_TYPE, {}));

      const view = await service.replaceSettings(
        FAKE_DYNAMIC_TYPE,
        { 'kycProvider.token': 'x' },
        'operator',
      );

      expect(repository.upsert).toHaveBeenCalledWith(
        manager,
        FAKE_DYNAMIC_TYPE,
        { 'kycProvider.token': 'x' },
        'operator',
      );
      expect(view.settings).toEqual([
        { key: 'kycProvider.token', secret: true, required: false, source: 'stored' },
      ]);
    });

    it('throws ConnectorTypeNotFoundException for an unknown connector type', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings('unregistered_connector', {}, 'operator'),
      ).rejects.toThrow(ConnectorTypeNotFoundException);
    });

    it('records a connector_settings.updated row naming the touched keys, with no value in it', async () => {
      const { service, auditService } = createService();
      const submittedSecret = 'sk-live-super-secret-value';

      await service.replaceSettings(
        FAKE_TYPE,
        { apiKey: submittedSecret, from: 'ops@example.com' },
        'operator-oid',
      );

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(expect.anything(), {
        action: 'connector_settings.updated',
        actorId: 'operator-oid',
        resourceId: FAKE_TYPE,
        metadata: { connectorType: FAKE_TYPE, keys: ['apiKey', 'from'] },
      });
      const recordedRow = auditService.logConnectorSettingsChange.mock.calls[0][1];
      expect(JSON.stringify(recordedRow)).not.toContain(submittedSecret);
    });

    it('records the unknown-actor constant when no operator identity is available', async () => {
      const { service, auditService } = createService();

      await service.replaceSettings(FAKE_TYPE, { apiKey: 'a', from: 'b' }, null);

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorId: 'unknown' }),
      );
    });

    describe('smtp username/password pairing', () => {
      it('rejects a username with no password', async () => {
        const { service } = createService();

        await expect(
          service.replaceSettings('smtp', { username: 'ops' }, 'operator'),
        ).rejects.toMatchObject({
          response: { issues: [{ key: 'password', reason: 'missing_pairing' }] },
        });
      });

      it('rejects a password with no username', async () => {
        const { service } = createService();

        await expect(
          service.replaceSettings('smtp', { password: 'hunter2' }, 'operator'),
        ).rejects.toMatchObject({
          response: { issues: [{ key: 'username', reason: 'missing_pairing' }] },
        });
      });

      it('accepts both username and password together', async () => {
        const { service } = createService();

        await expect(
          service.replaceSettings('smtp', { username: 'ops', password: 'hunter2' }, 'operator'),
        ).resolves.toBeDefined();
      });

      it('accepts neither username nor password', async () => {
        const { service } = createService();

        await expect(service.replaceSettings('smtp', {}, 'operator')).resolves.toBeDefined();
      });
    });

    describe('dropping a currently stored key', () => {
      it('rejects a body that omits a currently stored key, naming it', async () => {
        const { service, repository } = createService();
        repository.find.mockResolvedValue(
          createRow(FAKE_TYPE, { apiKey: 'a', from: 'b', optional: 'c' }),
        );

        await expect(
          service.replaceSettings(FAKE_TYPE, { apiKey: 'a2', from: 'b2' }, 'operator'),
        ).rejects.toMatchObject({
          response: { issues: [{ key: 'optional', reason: 'would_be_dropped' }] },
        });
      });

      it('succeeds when the same request opts in with replace=true', async () => {
        const { service, repository } = createService();
        repository.find.mockResolvedValue(
          createRow(FAKE_TYPE, { apiKey: 'a', from: 'b', optional: 'c' }),
        );

        const view = await service.replaceSettings(
          FAKE_TYPE,
          { apiKey: 'a2', from: 'b2' },
          'operator',
          true,
        );

        expect(repository.upsert).toHaveBeenCalledWith(
          manager,
          FAKE_TYPE,
          { apiKey: 'a2', from: 'b2' },
          'operator',
        );
        expect(view.settings.find((setting) => setting.key === 'optional')?.source).toBe('unset');
      });

      it('is unaffected by a request that only adds or updates keys', async () => {
        const { service, repository } = createService();
        repository.find.mockResolvedValue(createRow(FAKE_TYPE, { apiKey: 'a', from: 'b' }));

        await expect(
          service.replaceSettings(
            FAKE_TYPE,
            { apiKey: 'a2', from: 'b2', optional: 'c' },
            'operator',
          ),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('mergeSettings', () => {
    /**
     * The one confusion this route must never make: `null` deletes a key, but an empty string
     * is still an invalid value. Blurring them would let an operator destroy a credential by
     * submitting an empty box, so the distinction is asserted here rather than left to the
     * shared helper's coverage on the wholesale path.
     */
    it('rejects an empty-string value instead of treating it as a deletion', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_TYPE, { apiKey: 'stored-key', from: 'stored-from' }),
      );

      await expect(
        service.mergeSettings(FAKE_TYPE, { apiKey: '' }, 'operator'),
      ).rejects.toMatchObject({
        response: {
          issues: expect.arrayContaining([{ key: 'apiKey', reason: 'invalid_value' }]),
        },
      });
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('keeps an omitted stored key exactly as stored', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_TYPE, { apiKey: 'stored-key', from: 'stored-from' }),
      );

      const view = await service.mergeSettings(FAKE_TYPE, { from: 'new-from' }, 'operator');

      expect(repository.upsert).toHaveBeenCalledWith(
        manager,
        FAKE_TYPE,
        { apiKey: 'stored-key', from: 'new-from' },
        'operator',
      );
      expect(view.settings.find((setting) => setting.key === 'apiKey')?.source).toBe('stored');
    });

    it('overwrites a submitted key', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_TYPE, { apiKey: 'stored-key', from: 'old-from', optional: 'kept' }),
      );

      await service.mergeSettings(FAKE_TYPE, { from: 'new-from' }, 'operator');

      expect(repository.upsert).toHaveBeenCalledWith(
        manager,
        FAKE_TYPE,
        { apiKey: 'stored-key', from: 'new-from', optional: 'kept' },
        'operator',
      );
    });

    it('deletes exactly the key submitted as null while others survive', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_TYPE, { apiKey: 'stored-key', from: 'stored-from', optional: 'kept' }),
      );

      const view = await service.mergeSettings(FAKE_TYPE, { optional: null }, 'operator');

      expect(repository.upsert).toHaveBeenCalledWith(
        manager,
        FAKE_TYPE,
        { apiKey: 'stored-key', from: 'stored-from' },
        'operator',
      );
      expect(view.settings.find((setting) => setting.key === 'optional')?.source).toBe('unset');
      expect(view.settings.find((setting) => setting.key === 'from')?.source).toBe('stored');
    });

    it('refuses a deletion that would leave a required key unset', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_TYPE, { apiKey: 'stored-key', from: 'stored-from' }),
      );

      await expect(
        service.mergeSettings(FAKE_TYPE, { from: null }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'from', reason: 'missing_required_key' }] },
      });
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('refuses deleting smtp.password while username stays stored', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow('smtp', { username: 'ops', password: 'hunter2' }),
      );

      await expect(
        service.mergeSettings('smtp', { password: null }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'password', reason: 'missing_pairing' }] },
      });
    });

    it('refuses an undeclared key for a fixed-schema connector', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_TYPE, { apiKey: 'a', from: 'b' }));

      await expect(
        service.mergeSettings(FAKE_TYPE, { bogus: 'x' }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'bogus', reason: 'undeclared_key' }] },
      });
    });

    it('accepts an undeclared key for an allowAdditionalKeys connector', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_DYNAMIC_TYPE, {}));

      const view = await service.mergeSettings(
        FAKE_DYNAMIC_TYPE,
        { 'kycProvider.token': 'x' },
        'operator',
      );

      expect(view.settings).toEqual([
        { key: 'kycProvider.token', secret: true, required: false, source: 'stored' },
      ]);
    });

    it('refuses a value failing its pattern', async () => {
      const { service } = createService();

      await expect(
        service.mergeSettings(FAKE_PATTERNED_TYPE, { email: 'not-an-email' }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'email', reason: 'invalid_format' }] },
      });
    });

    it('rejects an empty changes object', async () => {
      const { service } = createService();

      await expect(service.mergeSettings(FAKE_TYPE, {}, 'operator')).rejects.toThrow(
        ConnectorSettingsInvalidException,
      );
    });

    it('never raises would_be_dropped', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_TYPE, { apiKey: 'stored-key', from: 'stored-from', optional: 'kept' }),
      );

      await expect(
        service.mergeSettings(FAKE_TYPE, { from: 'new-from' }, 'operator'),
      ).resolves.toBeDefined();
    });

    it('records a connector_settings.updated row naming exactly the submitted keys, including a deleted one, with no value in it', async () => {
      const { service, repository, auditService } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_TYPE, { apiKey: 'stored-key', from: 'stored-from', optional: 'kept' }),
      );
      const submittedSecret = 'sk-live-super-secret-value';

      await service.mergeSettings(
        FAKE_TYPE,
        { apiKey: submittedSecret, optional: null },
        'operator-oid',
      );

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(expect.anything(), {
        action: 'connector_settings.updated',
        actorId: 'operator-oid',
        resourceId: FAKE_TYPE,
        metadata: { connectorType: FAKE_TYPE, keys: ['apiKey', 'optional'] },
      });
      const recordedRow = auditService.logConnectorSettingsChange.mock.calls[0][1];
      expect(JSON.stringify(recordedRow)).not.toContain(submittedSecret);
    });

    it('throws ConnectorTypeNotFoundException for an unknown connector type', async () => {
      const { service } = createService();

      await expect(
        service.mergeSettings('unregistered_connector', { key: 'value' }, 'operator'),
      ).rejects.toThrow(ConnectorTypeNotFoundException);
    });
  });

  describe('removeSettings', () => {
    it('deletes the stored row', async () => {
      const { service, repository } = createService();

      await service.removeSettings(FAKE_TYPE);

      expect(repository.delete).toHaveBeenCalledWith(manager, FAKE_TYPE);
    });

    it('throws ConnectorTypeNotFoundException for an unknown connector type', async () => {
      const { service } = createService();

      await expect(service.removeSettings('unregistered_connector')).rejects.toThrow(
        ConnectorTypeNotFoundException,
      );
    });

    it('records a connector_settings.deleted row naming the keys that were stored', async () => {
      const { service, repository, auditService } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_TYPE, { apiKey: 'super-secret', from: 'x' }),
      );

      await service.removeSettings(FAKE_TYPE);

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(expect.anything(), {
        action: 'connector_settings.deleted',
        actorId: 'unknown',
        resourceId: FAKE_TYPE,
        metadata: { connectorType: FAKE_TYPE, keys: ['apiKey', 'from'] },
      });
      const recordedRow = auditService.logConnectorSettingsChange.mock.calls[0][1];
      expect(JSON.stringify(recordedRow)).not.toContain('super-secret');
    });

    it('still records a connector_settings.deleted row, with an empty key list, for a no-op delete', async () => {
      const { service, auditService } = createService();

      await service.removeSettings(FAKE_TYPE);

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(expect.anything(), {
        action: 'connector_settings.deleted',
        actorId: 'unknown',
        resourceId: FAKE_TYPE,
        metadata: { connectorType: FAKE_TYPE, keys: [] },
      });
    });

    it('records the real operator identity when it resolves to one', async () => {
      const { service, auditService } = createService();

      await service.removeSettings(FAKE_TYPE, 'operator-oid');

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorId: 'operator-oid' }),
      );
    });
  });
});
