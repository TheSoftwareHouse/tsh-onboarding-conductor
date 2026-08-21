import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
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

const createService = (
  rows: Partial<ConnectorSettingEntity>[] = [],
  environment: Record<string, string> = {},
  encryptionAvailable = true,
) => {
  const repository = {
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest
      .fn()
      .mockImplementation(({ where }: { where: { connectorType: string } }) =>
        Promise.resolve(rows.find((row) => row.connectorType === where.connectorType) ?? null),
      ),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as Repository<ConnectorSettingEntity>;
  const cipher = {
    available: encryptionAvailable,
    encrypt: jest.fn((value: string) => `enc.${value}`),
    isEncrypted: jest.fn((value: string) => value.startsWith('enc.')),
  } as unknown as ConnectorSettingsCipher;
  const service = new ConnectorSettingsService(repository, cipher, {
    get: jest.fn((name: string) => environment[name]),
  } as unknown as ConfigService<AppConfig, true>);

  return { service, repository, cipher };
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
      const { service, repository, cipher } = createService([
        { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, settings: { from: 'ops@example.com' } },
      ]);

      const saved = await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, {
        apiKey: '  SG.rotated  ',
      });

      expect(cipher.encrypt).toHaveBeenCalledWith('SG.rotated');
      expect(repository.upsert).toHaveBeenCalledWith(
        {
          connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE,
          settings: { from: 'ops@example.com', apiKey: 'enc.SG.rotated' },
        },
        ['connectorType'],
      );
      expect(saved.fields.map((field) => field.source)).toEqual(['database', 'database']);
    });

    it('hands a field back to its environment default when the submitted value is empty', async () => {
      const { service, repository } = createService(
        [
          {
            connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE,
            settings: { apiKey: 'enc.SG.stored', from: 'ops@example.com' },
          },
        ],
        { SENDGRID_API_KEY: 'SG.environment' },
      );

      const saved = await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { apiKey: '' });

      expect(repository.upsert).toHaveBeenCalledWith(
        {
          connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE,
          settings: { from: 'ops@example.com' },
        },
        ['connectorType'],
      );
      expect(saved.fields[0]).toMatchObject({ key: 'apiKey', source: 'environment' });
    });

    it('removes the row once the last stored setting is cleared', async () => {
      const { service, repository } = createService([
        { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, settings: { from: 'ops@example.com' } },
      ]);

      await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { from: '' });

      expect(repository.delete).toHaveBeenCalledWith({
        connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE,
      });
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('refuses a connector that declares no settings', async () => {
      const { service } = createService();

      await expect(service.save('http_request', { apiKey: 'x' })).rejects.toBeInstanceOf(
        ConnectorSettingsNotConfigurableException,
      );
    });

    it('names the keys it refuses instead of storing them', async () => {
      const { service, repository } = createService();

      await expect(
        service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { apiKey: 42, sender: 'ops@example.com' }),
      ).rejects.toMatchObject({
        response: {
          code: 'INVALID_CONNECTOR_SETTINGS',
          errors: { apiKey: ['INVALID'], sender: ['UNKNOWN'] },
        },
      });
      await expect(
        service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { apiKey: 'x'.repeat(4097) }),
      ).rejects.toBeInstanceOf(InvalidConnectorSettingsException);
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('refuses to store a secret with no encryption key configured', async () => {
      const { service, repository } = createService([], {}, false);

      await expect(
        service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, {
          apiKey: 'SG.rotated',
          from: 'ops@example.com',
        }),
      ).rejects.toBeInstanceOf(ConnectorSettingsEncryptionUnavailableException);
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('still edits non-secret settings with no encryption key configured', async () => {
      const { service, repository } = createService([], {}, false);

      await service.save(SENDGRID_EMAIL_CONNECTOR_TYPE, { from: 'ops@example.com' });

      expect(repository.upsert).toHaveBeenCalledWith(
        {
          connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE,
          settings: { from: 'ops@example.com' },
        },
        ['connectorType'],
      );
    });
  });
});
