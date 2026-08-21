import { SENDGRID_EMAIL_CONNECTOR_TYPE } from './connector-setting-declarations';
import { ConnectorSettingsController } from './connector-settings.controller';
import { ConnectorSettingsService } from './connector-settings.service';

describe('ConnectorSettingsController', () => {
  it('serves the connector catalogue as the service reports it', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({ items: [] }),
    } as unknown as ConnectorSettingsService;

    await expect(new ConnectorSettingsController(service).list()).resolves.toEqual({ items: [] });
    expect(service.list).toHaveBeenCalledWith();
  });

  it('passes the submitted values through to the service under the routed connector type', async () => {
    const saved = { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, label: 'SendGrid', fields: [] };
    const service = {
      save: jest.fn().mockResolvedValue(saved),
    } as unknown as ConnectorSettingsService;

    await expect(
      new ConnectorSettingsController(service).save(SENDGRID_EMAIL_CONNECTOR_TYPE, {
        values: { apiKey: 'SG.rotated' },
      }),
    ).resolves.toBe(saved);
    expect(service.save).toHaveBeenCalledWith(SENDGRID_EMAIL_CONNECTOR_TYPE, {
      apiKey: 'SG.rotated',
    });
  });
});
