import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { AdminOperatorIdentity } from '../auth/admin-access-audit.port';
import type { AppConfig } from '../config/app.config';
import {
  SENDGRID_EMAIL_CONNECTOR_TYPE,
  TWILIO_VERIFY_CONNECTOR_TYPE,
} from './connector-setting-declarations';
import { ConnectorSettingsCipher } from './connector-settings.cipher';
import { ConnectorSettingsService } from './connector-settings.service';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';
import { ConnectorSettingsEncryptionUnavailableException } from './errors/connector-settings-encryption-unavailable.exception';
import { ConnectorSettingsNotConfigurableException } from './errors/connector-settings-not-configurable.exception';
import { InvalidConnectorSettingsException } from './errors/invalid-connector-settings.exception';

const OPERATOR: AdminOperatorIdentity = {
  objectId: 'operator-oid',
  userPrincipalName: 'ops@example.com',
  tenantId: 'tenant-1',
  roles: ['admin'],
};

/**
 * Stands in for the merging upsert. The engine pushes the merge into one statement so concurrent
 * saves cannot overwrite each other, so the fake applies the same semantics — stored settings,
 * plus what was submitted, minus what was cleared — and the e2e suite covers the real SQL.
 */
const createService = (
  rows: Partial<ConnectorSettingEntity>[] = [],
  environment: Record<string, string> = {},
  encryptionAvailable = true,
) => {
  const stored = new Map(rows.map((row) => [row.connectorType, { ...row.settings }]));

  const repository = {
    metadata: { tableName: 'connector_settings' },
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest
      .fn()
      .mockImplementation(({ where }: { where: { connectorType: string } }) =>
        Promise.resolve(rows.find((row) => row.connectorType === where.connectorType) ?? null),
      ),
  } as unknown as Repository<ConnectorSettingEntity>;

  const manager = {
    query: jest.fn((_sql: string, parameters: [string, string, string[]]) => {
      const [connectorType, submittedJson, clearedKeys] = parameters;
      const merged = {
        ...(stored.get(connectorType) ?? {}),
        ...(JSON.parse(submittedJson) as Record<string, string>),
      };

      for (const key of clearedKeys) {
        delete merged[key];
      }

      stored.set(connectorType, merged);

      return Promise.resolve([{ settings: merged }]);
    }),
    delete: jest.fn((_entity: unknown, criteria: { connectorType: string }) => {
      stored.delete(criteria.connectorType);

      return Promise.resolve(undefined);
    }),
  } as unknown as EntityManager;

  const dataSource = {
    transaction: jest.fn((run: (manager: EntityManager) => Promise<unknown>) => run(manager)),
  } as unknown as DataSource;

  const auditService = {
    logConnectorSettingsChange: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const cipher = {
    available: encryptionAvailable,
    encrypt: jest.fn((value: string) => `enc.${value}`),
    isEncrypted: jest.fn((value: string) => value.startsWith('enc.')),
  } as unknown as ConnectorSettingsCipher;

  const service = new ConnectorSettingsService(
    repository,
    cipher,
    { get: jest.fn((name: string) => environment[name]) } as unknown as ConfigService<
      AppConfig,
      true
    >,
    dataSource,
    auditService,
  );

  /** The settings the merging upsert was asked to write, as a plain map. */
  const writtenSettings = (call = 0): Record<string, string> => {
    const parameters = (manager.query as jest.Mock).mock.calls[call][1] as [
      string,
      string,
      unknown,
    ];

    return JSON.parse(parameters[1]) as Record<string, string>;
  };

  const clearedKeys = (call = 0): string[] =>
    (manager.query as jest.Mock).mock.calls[call][1][2] as string[];

  return { service, repository, manager, auditService, cipher, writtenSettings, clearedKeys };
};

const findConnector = (
  items: Awaited<ReturnType<ConnectorSettingsService['list']>>['items'],
  connectorType: string,
) => items.find((item) => item.connectorType === connectorType);

describe('ConnectorSettingsService', () => {
  describe('list', () => {
    it('reports every configurable connector with the source each field takes effect from', async () => {
      const { service } = createService(
        [{ connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, settings: { from: 'ops@example.com' } }],
        { SENDGRID_API_KEY: 'SG.environment' },
      );

      const { items } = await service.list();

      expect(items.map((item) => item.connectorType)).toEqual([
        TWILIO_VERIFY_CONNECTOR_TYPE,
        SENDGRID_EMAIL_CONNECTOR_TYPE,
        'smtp',
      ]);
      expect(findConnector(items, SENDGRID_EMAIL_CONNECTOR_TYPE)?.fields).toEqual([
        {
          key: 'apiKey',
          label: 'API key',
          secret: true,
          required: true,
          source: 'environment',
          value: null,
        },
        {
          key: 'from',
          label: 'Sender address',
          secret: false,
          required: true,
          hint: 'Must be a verified SendGrid sender.',
          source: 'database',
          value: 'ops@example.com',
        },
      ]);
    });

    it('never reports a stored secret back, only that one is configured', async () => {
      const { service } = createService([
        { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, settings: { apiKey: 'enc.SG.stored' } },
      ]);

      const apiKey = findConnector(
        (await service.list()).items,
        SENDGRID_EMAIL_CONNECTOR_TYPE,
      )?.fields.find((field) => field.key === 'apiKey');

      expect(apiKey).toMatchObject({ source: 'database', value: null });
    });

    it('reports a field neither source supplies as unset', async () => {
      const { service } = createService();

      const fields = findConnector(
        (await service.list()).items,
        TWILIO_VERIFY_CONNECTOR_TYPE,
      )?.fields;

      expect(fields?.every((field) => field.source === 'unset' && field.value === null)).toBe(true);
    });
  });

  describe('save', () => {
    it('encrypts a secret, stores the rest as typed, and leaves untouched keys alone', async () => {
      const { service, writtenSettings, clearedKeys, cipher } = createService([
        { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, settings: { from: 'ops@example.com' } },
      ]);

      const saved = await service.save(
        SENDGRID_EMAIL_CONNECTOR_TYPE,
        { apiKey: '  SG.rotated  ' },
        OPERATOR,
      );

      expect(cipher.encrypt).toHaveBeenCalledWith('SG.rotated');
      // Only the submitted key is written; the merge leaves `from` to the row already there.
      expect(writtenSettings()).toEqual({ apiKey: 'enc.SG.rotated' });
      expect(clearedKeys()).toEqual([]);
      expect(saved.fields.map((field) => field.source)).toEqual(['database', 'database']);
    });

    it('hands a field back to its environment default when the submitted value is empty', async () => {
      const { service, writtenSettings, clearedKeys } = createService(
        [
          {
            connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE,
            settings: { apiKey: 'enc.SG.stored', from: 'ops@example.com' },
          },
        ],
        { SENDGRID_API_KEY: 'SG.environment' },
      );

      const saved = await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { apiKey: '' }, OPERATOR);

      expect(writtenSettings()).toEqual({});
      expect(clearedKeys()).toEqual(['apiKey']);
      expect(saved.fields[0]).toMatchObject({ key: 'apiKey', source: 'environment' });
    });

    it('removes the row once the last stored setting is cleared', async () => {
      const { service, manager } = createService([
        { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, settings: { from: 'ops@example.com' } },
      ]);

      await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { from: '' }, OPERATOR);

      expect(manager.delete).toHaveBeenCalledWith(ConnectorSettingEntity, {
        connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE,
      });
    });

    it('merges onto what is stored rather than onto what it read, so a concurrent save survives', async () => {
      const { service, writtenSettings } = createService([
        { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, settings: { from: 'ops@example.com' } },
      ]);

      await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { apiKey: 'SG.rotated' }, OPERATOR);

      // The statement carries only the edited key, so the database merges it onto whatever the
      // row holds at commit time instead of replacing the whole settings blob.
      expect(writtenSettings()).not.toHaveProperty('from');
    });

    it('records who changed which settings, and never what they became', async () => {
      const { service, auditService } = createService();

      await service.save(
        SENDGRID_EMAIL_CONNECTOR_TYPE,
        { apiKey: 'SG.rotated', from: '' },
        OPERATOR,
      );

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(expect.anything(), {
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: SENDGRID_EMAIL_CONNECTOR_TYPE,
        metadata: { storedKeys: ['apiKey'], clearedKeys: ['from'] },
      });

      const [, input] = (auditService.logConnectorSettingsChange as jest.Mock).mock.calls[0] as [
        unknown,
        { metadata: Record<string, unknown> },
      ];
      expect(JSON.stringify(input.metadata)).not.toContain('SG.rotated');
    });

    it('records a change made through the local no-auth escape hatch as anonymous', async () => {
      const { service, auditService } = createService();

      await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { from: 'ops@example.com' }, null);

      expect(auditService.logConnectorSettingsChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorType: 'anonymous', actorId: '' }),
      );
    });

    it('writes nothing and records nothing when the submitted values change none', async () => {
      const { service, manager, auditService } = createService([
        { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, settings: { from: 'ops@example.com' } },
      ]);

      const saved = await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, {}, OPERATOR);

      expect(manager.query).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(auditService.logConnectorSettingsChange).not.toHaveBeenCalled();
      expect(saved.fields[1]).toMatchObject({ key: 'from', source: 'database' });
    });

    it('refuses a connector that declares no settings', async () => {
      const { service } = createService();

      await expect(service.save('http_request', { apiKey: 'x' }, OPERATOR)).rejects.toBeInstanceOf(
        ConnectorSettingsNotConfigurableException,
      );
    });

    it('names the keys it refuses instead of storing them', async () => {
      const { service, manager } = createService();

      await expect(
        service.save(
          SENDGRID_EMAIL_CONNECTOR_TYPE,
          { apiKey: 42, sender: 'ops@example.com' },
          OPERATOR,
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'INVALID_CONNECTOR_SETTINGS',
          errors: { apiKey: ['INVALID'], sender: ['UNKNOWN'] },
        },
      });
      await expect(
        service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { apiKey: 'x'.repeat(4097) }, OPERATOR),
      ).rejects.toBeInstanceOf(InvalidConnectorSettingsException);
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('refuses an undeclared key that names an object prototype member', async () => {
      const { service, manager } = createService();

      // `__proto__` assigns to an object's prototype rather than becoming an own key, so a refusal
      // collected in an object literal would vanish and the caller would be told the request
      // succeeded. The global ValidationPipe happens to strip the key before any HTTP request
      // gets this far, which is exactly why the service cannot rely on it doing so.
      await expect(
        service.save(
          SENDGRID_EMAIL_CONNECTOR_TYPE,
          JSON.parse('{"__proto__":"x"}') as Record<string, unknown>,
          OPERATOR,
        ),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_CONNECTOR_SETTINGS', errors: { ['__proto__']: ['UNKNOWN'] } },
      });
      expect(manager.query).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('refuses to store a secret with no encryption key configured', async () => {
      const { service, manager } = createService([], {}, false);

      await expect(
        service.save(
          SENDGRID_EMAIL_CONNECTOR_TYPE,
          { apiKey: 'SG.rotated', from: 'ops@example.com' },
          OPERATOR,
        ),
      ).rejects.toBeInstanceOf(ConnectorSettingsEncryptionUnavailableException);
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('still edits non-secret settings with no encryption key configured', async () => {
      const { service, writtenSettings } = createService([], {}, false);

      await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { from: 'ops@example.com' }, OPERATOR);

      expect(writtenSettings()).toEqual({ from: 'ops@example.com' });
    });
  });
});
