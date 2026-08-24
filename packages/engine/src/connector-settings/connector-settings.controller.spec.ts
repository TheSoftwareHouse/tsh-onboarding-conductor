import type { AuthenticatedRequest } from '../auth/azure-jwt.guard';
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

  it('passes the submitted values through under the routed connector type, naming the operator', async () => {
    const saved = { connectorType: SENDGRID_EMAIL_CONNECTOR_TYPE, label: 'SendGrid', fields: [] };
    const service = {
      save: jest.fn().mockResolvedValue(saved),
    } as unknown as ConnectorSettingsService;
    const request = {
      adminTokenClaims: { oid: 'operator-oid', preferred_username: 'ops@example.com', tid: 't-1' },
    } as AuthenticatedRequest;

    await expect(
      new ConnectorSettingsController(service).save(
        SENDGRID_EMAIL_CONNECTOR_TYPE,
        { values: { apiKey: 'SG.rotated' } },
        request,
      ),
    ).resolves.toBe(saved);
    expect(service.save).toHaveBeenCalledWith(
      SENDGRID_EMAIL_CONNECTOR_TYPE,
      { apiKey: 'SG.rotated' },
      expect.objectContaining({ objectId: 'operator-oid', userPrincipalName: 'ops@example.com' }),
    );
  });

  it('names no operator when the guard admitted the request without a token', async () => {
    const service = {
      save: jest.fn().mockResolvedValue({}),
    } as unknown as ConnectorSettingsService;

    await new ConnectorSettingsController(service).save(
      SENDGRID_EMAIL_CONNECTOR_TYPE,
      { values: {} },
      {} as AuthenticatedRequest,
    );

    expect(service.save).toHaveBeenCalledWith(SENDGRID_EMAIL_CONNECTOR_TYPE, {}, null);
  });
});
