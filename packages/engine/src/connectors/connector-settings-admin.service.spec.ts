import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { ConnectorAdapterScopes } from './connector-adapter-scope';
import { ConnectorSettingsAdminService } from './connector-settings-admin.service';
import { ConnectorsRepository } from './connectors.repository';
import { ConnectorSettingsService } from './connector-settings.service';
import { ConnectorEntity } from './entity/connector.entity';
import { ConnectorSettingsInvalidException } from './errors/connector-settings-invalid.exception';
import { ConnectorNotFoundException } from './errors/connector-not-found.exception';
import type { ConnectorAdapter } from './ports/connector-adapter.port';

const manager = {} as EntityManager;

const FAKE_ID = 'fake_connector';
const FAKE_UNCONFIGURABLE_ID = 'fake_unconfigurable_connector';
const FAKE_PATTERNED_ID = 'fake_patterned_connector';
const FAKE_REQUIRED_PATTERNED_ID = 'fake_required_patterned_connector';

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
  id: FAKE_UNCONFIGURABLE_ID,
  type: 'custom',
  execute: jest.fn(),
};

/** Carries a `pattern` on its one field, so the merge path's per-value pattern check
 * has something to fail against without disturbing `fakeAdapter`'s other tests. */
const fakePatternedAdapter: ConnectorAdapter = {
  name: 'Fake Patterned Connector',
  id: FAKE_PATTERNED_ID,
  type: 'custom',
  settingsSchema: {
    fields: [{ key: 'email', secret: false, required: false, pattern: /^\S+@\S+$/ }],
  },
  execute: jest.fn(),
};

/** One *required* field carrying a `pattern`, so a refused value and the required-key check
 * land on the same key without disturbing `fakePatternedAdapter`'s optional-field tests. */
const fakeRequiredPatternedAdapter: ConnectorAdapter = {
  name: 'Fake Required Patterned Connector',
  id: FAKE_REQUIRED_PATTERNED_ID,
  type: 'custom',
  settingsSchema: {
    fields: [{ key: 'email', secret: false, required: true, pattern: /^\S+@\S+$/ }],
  },
  execute: jest.fn(),
};

/** Same id and schema shape as the real `SmtpConnector` — the pairing rule is keyed on the
 * literal connector id `'smtp'`, not on the fake adapter's name. */
const fakeSmtpAdapter: ConnectorAdapter = {
  name: 'smtp',
  id: 'smtp',
  type: 'email_delivery',
  settingsSchema: {
    fields: [
      { key: 'username', secret: false, required: false },
      { key: 'password', secret: true, required: false },
    ],
  },
  execute: jest.fn(),
};

/**
 * `FAKE_ID` and `FAKE_PATTERNED_ID` are each placed in a different group; `smtp` is left out
 * of the map entirely to prove `buildView` falls back to `users`, consistent with
 * `resolveConnectorAdapterScopes`.
 */
const connectorAdapterScopes: ConnectorAdapterScopes = new Map([
  [FAKE_ID, 'fixtures'],
  [FAKE_PATTERNED_ID, 'built-in'],
]);

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
  service: ConnectorSettingsAdminService;
  repository: jest.Mocked<ConnectorsRepository>;
  auditService: jest.Mocked<Pick<AuditService, 'logConnectorSettingsChange'>>;
} {
  const repository = {
    lock: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    ...options?.repository,
  } as unknown as jest.Mocked<ConnectorsRepository>;

  // `transaction` runs its callback against the same fake manager the non-transactional reads
  // use, so a spec asserting on `repository` sees the locked write path exactly as it sees the
  // unlocked reads. `lock` is a no-op here — what it serializes is a database concern, proved by
  // `connector-settings.e2e-spec.ts` rather than by a mock.
  const dataSource = {
    manager,
    transaction: (runInTransaction: (entityManager: EntityManager) => Promise<unknown>) =>
      runInTransaction(manager),
  } as unknown as DataSource;
  const connectorSettingsService = new ConnectorSettingsService(repository, dataSource);
  const auditService = {
    logConnectorSettingsChange: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<AuditService, 'logConnectorSettingsChange'>>;

  const service = new ConnectorSettingsAdminService(
    connectorSettingsService,
    [
      fakeAdapter,
      fakeUnconfigurableAdapter,
      fakePatternedAdapter,
      fakeRequiredPatternedAdapter,
      fakeSmtpAdapter,
    ],
    connectorAdapterScopes,
    auditService as unknown as AuditService,
    dataSource,
  );

  return { service, repository, auditService };
}

describe('ConnectorSettingsAdminService', () => {
  describe('concurrent writes', () => {
    it('locks the connector before reading the map every write path then replaces', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_ID, { apiKey: 'stored' }));

      await service.mergeSettings(FAKE_ID, { from: 'a@b.co' }, 'operator');

      // The lock must be taken before the read it protects, or two requests can still
      // read the same starting map and the second erase the first's keys.
      expect(repository.lock).toHaveBeenCalledWith(expect.anything(), FAKE_ID);
      expect(repository.lock.mock.invocationCallOrder[0]).toBeLessThan(
        repository.find.mock.invocationCallOrder[0],
      );
      expect(repository.find.mock.invocationCallOrder[0]).toBeLessThan(
        repository.upsert.mock.invocationCallOrder[0],
      );
    });

    it('locks before the wholesale replace path reads the map', async () => {
      const { service, repository } = createService();

      await service.replaceSettings(FAKE_ID, { apiKey: 'k', from: 'a@b.co' }, 'operator');

      expect(repository.lock).toHaveBeenCalledWith(expect.anything(), FAKE_ID);
      expect(repository.lock.mock.invocationCallOrder[0]).toBeLessThan(
        repository.upsert.mock.invocationCallOrder[0],
      );
    });

    it('locks before the delete path reads the keys it audits', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_ID, { apiKey: 'stored' }));

      await service.removeSettings(FAKE_ID, 'operator');

      expect(repository.lock).toHaveBeenCalledWith(expect.anything(), FAKE_ID);
      expect(repository.lock.mock.invocationCallOrder[0]).toBeLessThan(
        repository.delete.mock.invocationCallOrder[0],
      );
    });

    it('writes nothing when validation rejects the merged result', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_ID, { apiKey: 'stored' }));

      await expect(service.mergeSettings(FAKE_ID, { apiKey: null }, 'operator')).rejects.toThrow(
        ConnectorSettingsInvalidException,
      );

      expect(repository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('findSettings / listSettings', () => {
    it('never includes a secret value in the response model', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_ID, { apiKey: 'super-secret' }));

      const view = await service.findSettings(FAKE_ID);
      const apiKeySetting = view.settings.find((setting) => setting.key === 'apiKey');

      expect(apiKeySetting?.secret).toBe(true);
      expect(apiKeySetting?.source).toBe('stored');
      expect(apiKeySetting?.value).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain('super-secret');
    });

    it('reports source as stored or unset per key', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_ID, { apiKey: 'stored-key', from: 'stored-from' }),
      );

      const view = await service.findSettings(FAKE_ID);

      expect(view.settings.find((setting) => setting.key === 'apiKey')?.source).toBe('stored');
      expect(view.settings.find((setting) => setting.key === 'from')?.source).toBe('stored');
      expect(view.settings.find((setting) => setting.key === 'from')?.value).toBe('stored-from');
      expect(view.settings.find((setting) => setting.key === 'optional')?.source).toBe('unset');
      expect(view.configured).toBe(true);
    });

    it('reports configured false when a required key is unresolvable', async () => {
      const { service } = createService();

      const view = await service.findSettings(FAKE_ID);

      expect(view.configured).toBe(false);
    });

    it('throws ConnectorNotFoundException for an unknown connector id', async () => {
      const { service } = createService();

      await expect(service.findSettings('unregistered_connector')).rejects.toThrow(
        ConnectorNotFoundException,
      );
    });

    it('throws ConnectorNotFoundException for a connector with no settingsSchema', async () => {
      const { service } = createService();

      await expect(service.findSettings(FAKE_UNCONFIGURABLE_ID)).rejects.toThrow(
        ConnectorNotFoundException,
      );
    });

    it('lists only connectors that declare a settingsSchema', async () => {
      const { service } = createService();

      const views = await service.listSettings();

      expect(views.map((view) => view.id)).toEqual([
        FAKE_ID,
        FAKE_PATTERNED_ID,
        FAKE_REQUIRED_PATTERNED_ID,
        'smtp',
      ]);
    });

    it("reports each connector's scope, falling back to users when unregistered", async () => {
      const { service } = createService();

      const views = await service.listSettings();

      expect(views.map((view) => view.scope)).toEqual(['fixtures', 'built-in', 'users', 'users']);
    });

    it('reports scope on a single connector read', async () => {
      const { service } = createService();

      const view = await service.findSettings(FAKE_PATTERNED_ID);

      expect(view.scope).toBe('built-in');
    });
  });

  describe('replaceSettings', () => {
    it('stores validated settings and rejects an undeclared key', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_ID, { apiKey: 'a', from: 'b', bogus: 'c' }, 'operator'),
      ).rejects.toThrow(ConnectorSettingsInvalidException);
    });

    it('collects every offending key in a single exception', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_ID, { apiKey: 1, from: '', bogus: 'x' }, 'operator'),
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
        service.replaceSettings(FAKE_ID, { apiKey: 'a' }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'from', reason: 'missing_required_key' }] },
      });
    });

    it('does not also report a required key as missing when its own value was refused', async () => {
      const { service } = createService();

      // The key is in the request; it was refused for its format. Reporting it missing as well
      // would tell the operator a key they can see in the form is absent.
      await expect(
        service.replaceSettings(FAKE_REQUIRED_PATTERNED_ID, { email: 'not-an-email' }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'email', reason: 'invalid_format' }] },
      });
    });

    it('still reports a required key that was genuinely never submitted alongside a refused one', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_ID, { apiKey: '' }, 'operator'),
      ).rejects.toMatchObject({
        response: {
          issues: [
            { key: 'apiKey', reason: 'invalid_value' },
            { key: 'from', reason: 'missing_required_key' },
          ],
        },
      });
    });

    it('rejects a non-string value', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_ID, { apiKey: 'a', from: 42 }, 'operator'),
      ).rejects.toMatchObject({
        response: {
          issues: expect.arrayContaining([{ key: 'from', reason: 'invalid_value' }]),
        },
      });
    });

    it('rejects an empty-string value', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings(FAKE_ID, { apiKey: 'a', from: '' }, 'operator'),
      ).rejects.toMatchObject({
        response: {
          issues: expect.arrayContaining([{ key: 'from', reason: 'invalid_value' }]),
        },
      });
    });

    it('throws ConnectorNotFoundException for an unknown connector id', async () => {
      const { service } = createService();

      await expect(
        service.replaceSettings('unregistered_connector', {}, 'operator'),
      ).rejects.toThrow(ConnectorNotFoundException);
    });

    it('records a connector_settings.updated row naming the touched keys, with no value in it', async () => {
      const { service, auditService } = createService();
      const submittedSecret = 'sk-live-super-secret-value';

      await service.replaceSettings(
        FAKE_ID,
        { apiKey: submittedSecret, from: 'ops@example.com' },
        'operator-oid',
      );

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(expect.anything(), {
        action: 'connector_settings.updated',
        actorId: 'operator-oid',
        resourceId: FAKE_ID,
        metadata: { connectorId: FAKE_ID, keys: ['apiKey', 'from'] },
      });
      const recordedRow = auditService.logConnectorSettingsChange.mock.calls[0][1];
      expect(JSON.stringify(recordedRow)).not.toContain(submittedSecret);
    });

    it('records the unknown-actor constant when no operator identity is available', async () => {
      const { service, auditService } = createService();

      await service.replaceSettings(FAKE_ID, { apiKey: 'a', from: 'b' }, null);

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

      it('does not also report the pair as broken when the half it would name was refused', async () => {
        const { service } = createService();

        // `username` is in the request and was refused for its value. It is absent from the
        // validated map only because of that, so the pair cannot be judged and the operator
        // already has the actionable reason.
        await expect(
          service.replaceSettings('smtp', { username: '', password: 'hunter2' }, 'operator'),
        ).rejects.toMatchObject({
          response: { issues: [{ key: 'username', reason: 'invalid_value' }] },
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
          createRow(FAKE_ID, { apiKey: 'a', from: 'b', optional: 'c' }),
        );

        await expect(
          service.replaceSettings(FAKE_ID, { apiKey: 'a2', from: 'b2' }, 'operator'),
        ).rejects.toMatchObject({
          response: { issues: [{ key: 'optional', reason: 'would_be_dropped' }] },
        });
      });

      it('succeeds when the same request opts in with replace=true', async () => {
        const { service, repository } = createService();
        repository.find.mockResolvedValue(
          createRow(FAKE_ID, { apiKey: 'a', from: 'b', optional: 'c' }),
        );

        const view = await service.replaceSettings(
          FAKE_ID,
          { apiKey: 'a2', from: 'b2' },
          'operator',
          true,
        );

        expect(repository.upsert).toHaveBeenCalledWith(
          manager,
          FAKE_ID,
          'custom',
          { apiKey: 'a2', from: 'b2' },
          'operator',
        );
        expect(view.settings.find((setting) => setting.key === 'optional')?.source).toBe('unset');
      });

      it('is unaffected by a request that only adds or updates keys', async () => {
        const { service, repository } = createService();
        repository.find.mockResolvedValue(createRow(FAKE_ID, { apiKey: 'a', from: 'b' }));

        await expect(
          service.replaceSettings(FAKE_ID, { apiKey: 'a2', from: 'b2', optional: 'c' }, 'operator'),
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
        createRow(FAKE_ID, { apiKey: 'stored-key', from: 'stored-from' }),
      );

      await expect(
        service.mergeSettings(FAKE_ID, { apiKey: '' }, 'operator'),
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
        createRow(FAKE_ID, { apiKey: 'stored-key', from: 'stored-from' }),
      );

      const view = await service.mergeSettings(FAKE_ID, { from: 'new-from' }, 'operator');

      expect(repository.upsert).toHaveBeenCalledWith(
        manager,
        FAKE_ID,
        'custom',
        { apiKey: 'stored-key', from: 'new-from' },
        'operator',
      );
      expect(view.settings.find((setting) => setting.key === 'apiKey')?.source).toBe('stored');
    });

    it('overwrites a submitted key', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_ID, { apiKey: 'stored-key', from: 'old-from', optional: 'kept' }),
      );

      await service.mergeSettings(FAKE_ID, { from: 'new-from' }, 'operator');

      expect(repository.upsert).toHaveBeenCalledWith(
        manager,
        FAKE_ID,
        'custom',
        { apiKey: 'stored-key', from: 'new-from', optional: 'kept' },
        'operator',
      );
    });

    it('deletes exactly the key submitted as null while others survive', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_ID, { apiKey: 'stored-key', from: 'stored-from', optional: 'kept' }),
      );

      const view = await service.mergeSettings(FAKE_ID, { optional: null }, 'operator');

      expect(repository.upsert).toHaveBeenCalledWith(
        manager,
        FAKE_ID,
        'custom',
        { apiKey: 'stored-key', from: 'stored-from' },
        'operator',
      );
      expect(view.settings.find((setting) => setting.key === 'optional')?.source).toBe('unset');
      expect(view.settings.find((setting) => setting.key === 'from')?.source).toBe('stored');
    });

    it('refuses a deletion that would leave a required key unset', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_ID, { apiKey: 'stored-key', from: 'stored-from' }),
      );

      await expect(
        service.mergeSettings(FAKE_ID, { from: null }, 'operator'),
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
      repository.find.mockResolvedValue(createRow(FAKE_ID, { apiKey: 'a', from: 'b' }));

      await expect(
        service.mergeSettings(FAKE_ID, { bogus: 'x' }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'bogus', reason: 'undeclared_key' }] },
      });
    });

    it('refuses a value failing its pattern', async () => {
      const { service } = createService();

      await expect(
        service.mergeSettings(FAKE_PATTERNED_ID, { email: 'not-an-email' }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'email', reason: 'invalid_format' }] },
      });
    });

    it('does not also report a required key as missing when its own value was refused', async () => {
      const { service } = createService();

      await expect(
        service.mergeSettings(FAKE_REQUIRED_PATTERNED_ID, { email: 'not-an-email' }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'email', reason: 'invalid_format' }] },
      });
    });

    it('does not also report smtp pairing when the half it would name was refused', async () => {
      const { service } = createService();

      await expect(
        service.mergeSettings('smtp', { username: '', password: 'hunter2' }, 'operator'),
      ).rejects.toMatchObject({
        response: { issues: [{ key: 'username', reason: 'invalid_value' }] },
      });
    });

    it('rejects an empty changes object', async () => {
      const { service } = createService();

      await expect(service.mergeSettings(FAKE_ID, {}, 'operator')).rejects.toThrow(
        ConnectorSettingsInvalidException,
      );
    });

    it('never raises would_be_dropped', async () => {
      const { service, repository } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_ID, { apiKey: 'stored-key', from: 'stored-from', optional: 'kept' }),
      );

      await expect(
        service.mergeSettings(FAKE_ID, { from: 'new-from' }, 'operator'),
      ).resolves.toBeDefined();
    });

    it('records a connector_settings.updated row naming exactly the submitted keys, including a deleted one, with no value in it', async () => {
      const { service, repository, auditService } = createService();
      repository.find.mockResolvedValue(
        createRow(FAKE_ID, { apiKey: 'stored-key', from: 'stored-from', optional: 'kept' }),
      );
      const submittedSecret = 'sk-live-super-secret-value';

      await service.mergeSettings(
        FAKE_ID,
        { apiKey: submittedSecret, optional: null },
        'operator-oid',
      );

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(expect.anything(), {
        action: 'connector_settings.updated',
        actorId: 'operator-oid',
        resourceId: FAKE_ID,
        metadata: { connectorId: FAKE_ID, keys: ['apiKey', 'optional'] },
      });
      const recordedRow = auditService.logConnectorSettingsChange.mock.calls[0][1];
      expect(JSON.stringify(recordedRow)).not.toContain(submittedSecret);
    });

    it('throws ConnectorNotFoundException for an unknown connector id', async () => {
      const { service } = createService();

      await expect(
        service.mergeSettings('unregistered_connector', { key: 'value' }, 'operator'),
      ).rejects.toThrow(ConnectorNotFoundException);
    });
  });

  describe('removeSettings', () => {
    it('deletes the stored row', async () => {
      const { service, repository } = createService();

      await service.removeSettings(FAKE_ID);

      expect(repository.delete).toHaveBeenCalledWith(manager, FAKE_ID);
    });

    it('throws ConnectorNotFoundException for an unknown connector id', async () => {
      const { service } = createService();

      await expect(service.removeSettings('unregistered_connector')).rejects.toThrow(
        ConnectorNotFoundException,
      );
    });

    it('records a connector_settings.deleted row naming the keys that were stored', async () => {
      const { service, repository, auditService } = createService();
      repository.find.mockResolvedValue(createRow(FAKE_ID, { apiKey: 'super-secret', from: 'x' }));

      await service.removeSettings(FAKE_ID);

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(expect.anything(), {
        action: 'connector_settings.deleted',
        actorId: 'unknown',
        resourceId: FAKE_ID,
        metadata: { connectorId: FAKE_ID, keys: ['apiKey', 'from'] },
      });
      const recordedRow = auditService.logConnectorSettingsChange.mock.calls[0][1];
      expect(JSON.stringify(recordedRow)).not.toContain('super-secret');
    });

    it('still records a connector_settings.deleted row, with an empty key list, for a no-op delete', async () => {
      const { service, auditService } = createService();

      await service.removeSettings(FAKE_ID);

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(expect.anything(), {
        action: 'connector_settings.deleted',
        actorId: 'unknown',
        resourceId: FAKE_ID,
        metadata: { connectorId: FAKE_ID, keys: [] },
      });
    });

    it('records the real operator identity when it resolves to one', async () => {
      const { service, auditService } = createService();

      await service.removeSettings(FAKE_ID, 'operator-oid');

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorId: 'operator-oid' }),
      );
    });
  });
});
