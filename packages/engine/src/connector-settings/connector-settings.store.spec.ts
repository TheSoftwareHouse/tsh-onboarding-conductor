import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import type { AppConfig } from '../config/app.config';
import {
  SENDGRID_EMAIL_CONNECTOR_TYPE,
  SMTP_CONNECTOR_TYPE,
} from './connector-setting-declarations';
import { ConnectorSettingsCipher } from './connector-settings.cipher';
import { ConnectorSettingsStore } from './connector-settings.store';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';
import { ConnectorSettingsDecryptionError } from './errors/connector-settings-decryption.error';

const createStore = (
  stored: Record<string, string> | null,
  environment: Record<string, string> = {},
) => {
  const repository = {
    findOne: jest
      .fn()
      .mockResolvedValue(stored === null ? null : ({ settings: stored } as ConnectorSettingEntity)),
  } as unknown as Repository<ConnectorSettingEntity>;
  const configService = {
    get: jest.fn((name: string) => environment[name]),
  } as unknown as ConfigService<AppConfig, true>;
  const cipher = {
    decrypt: jest.fn((value: string) =>
      value.startsWith('enc.') ? value.slice('enc.'.length) : value,
    ),
  } as unknown as ConnectorSettingsCipher;

  return { store: new ConnectorSettingsStore(repository, cipher, configService), repository };
};

describe('ConnectorSettingsStore', () => {
  it('prefers what an operator stored over the environment default, and decrypts a secret', async () => {
    const { store, repository } = createStore(
      { apiKey: 'enc.SG.stored', from: 'stored@example.com' },
      { SENDGRID_API_KEY: 'SG.environment', SENDGRID_FROM: 'environment@example.com' },
    );

    await expect(store.getValues(SENDGRID_EMAIL_CONNECTOR_TYPE)).resolves.toEqual({
      apiKey: 'SG.stored',
      from: 'stored@example.com',
    });
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE },
    });
  });

  it('falls back to the environment per field, so a partly configured connector still runs', async () => {
    const { store } = createStore(
      { apiKey: 'enc.SG.stored' },
      { SENDGRID_FROM: '  environment@example.com  ' },
    );

    await expect(store.getValues(SENDGRID_EMAIL_CONNECTOR_TYPE)).resolves.toEqual({
      apiKey: 'SG.stored',
      from: 'environment@example.com',
    });
  });

  it('omits a field neither source supplies rather than reporting it as empty', async () => {
    const { store } = createStore(null, { SMTP_HOST: 'mailhog', SMTP_FROM: '   ' });

    await expect(store.getValues(SMTP_CONNECTOR_TYPE)).resolves.toEqual({ host: 'mailhog' });
  });

  it('refuses to fall back to the environment when a stored secret cannot be decrypted', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({ settings: { apiKey: 'enc.v1.broken' } }),
    } as unknown as Repository<ConnectorSettingEntity>;
    const cipher = {
      decrypt: jest.fn(() => {
        throw new Error('unauthenticated');
      }),
    } as unknown as ConnectorSettingsCipher;
    const store = new ConnectorSettingsStore(repository, cipher, {
      get: jest.fn(() => 'SG.environment'),
    } as unknown as ConfigService<AppConfig, true>);

    await expect(store.getValues(SENDGRID_EMAIL_CONNECTOR_TYPE)).rejects.toBeInstanceOf(
      ConnectorSettingsDecryptionError,
    );
  });
});
