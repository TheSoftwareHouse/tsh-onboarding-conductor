import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AzureJwtGuard } from '../auth/azure-jwt.guard';
import type {
  ConnectorSettingsAdminService,
  ConnectorSettingsView,
} from './connector-settings-admin.service';
import { ConnectorsController } from './connectors.controller';
import { ConnectorTypeNotFoundException } from './errors/connector-type-not-found.exception';
import { ReplaceConnectorSettingsQueryDto } from './dto/replace-connector-settings.query.dto';
import { UpdateConnectorSettingsRequestDto } from './dto/update-connector-settings.request.dto';

const noReplaceQuery = new ReplaceConnectorSettingsQueryDto();

const createServiceStub = (): jest.Mocked<ConnectorSettingsAdminService> =>
  ({
    findSettings: jest.fn(),
    listSettings: jest.fn(),
    replaceSettings: jest.fn(),
    removeSettings: jest.fn(),
  }) as unknown as jest.Mocked<ConnectorSettingsAdminService>;

const buildView = (overrides: Partial<ConnectorSettingsView> = {}): ConnectorSettingsView => ({
  type: 'sendgrid_email',
  name: 'sendgrid_email',
  configured: true,
  allowAdditionalKeys: false,
  settings: [
    { key: 'apiKey', secret: true, required: true, source: 'stored' },
    { key: 'from', secret: false, required: true, source: 'stored', value: 'ops@tsh.io' },
    { key: 'unused', secret: true, required: false, source: 'unset' },
  ],
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedBy: 'operator-oid',
  ...overrides,
});

describe('ConnectorsController', () => {
  const methodsByRoute: Record<'list' | 'get' | 'replace' | 'remove', keyof ConnectorsController> =
    {
      list: 'list',
      get: 'get',
      replace: 'replace',
      remove: 'remove',
    };

  it('carries AzureJwtGuard on every route', () => {
    for (const method of Object.values(methodsByRoute)) {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        ConnectorsController.prototype[method],
      ) as unknown[] | undefined;

      expect(guards).toContain(AzureJwtGuard);
    }
  });

  describe('list', () => {
    it('maps every connector to the response shape, omitting secret values and serializing updatedAt', async () => {
      const service = createServiceStub();
      service.listSettings.mockResolvedValue([
        buildView(),
        buildView({ type: 'smtp', name: 'smtp', allowAdditionalKeys: true }),
      ]);
      const controller = new ConnectorsController(service);

      const response = await controller.list();

      expect(response.connectors).toHaveLength(2);
      const [sendgrid, smtp] = response.connectors;
      expect(sendgrid.updatedAt).toBe('2026-01-01T00:00:00.000Z');
      const secretSetting = sendgrid.settings.find((setting) => setting.key === 'apiKey');
      expect(secretSetting?.value).toBeUndefined();
      const plainSetting = sendgrid.settings.find((setting) => setting.key === 'from');
      expect(plainSetting?.value).toBe('ops@tsh.io');
      expect(sendgrid.allowAdditionalKeys).toBe(false);
      expect(smtp.allowAdditionalKeys).toBe(true);
    });
  });

  describe('get', () => {
    it('reports every declared source verbatim', async () => {
      const service = createServiceStub();
      service.findSettings.mockResolvedValue(buildView());
      const controller = new ConnectorsController(service);

      const response = await controller.get('sendgrid_email');

      expect(service.findSettings).toHaveBeenCalledWith('sendgrid_email');
      expect(response.settings.map((setting) => setting.source)).toEqual([
        'stored',
        'stored',
        'unset',
      ]);
      expect(response.updatedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(response.updatedBy).toBe('operator-oid');
      expect(response.allowAdditionalKeys).toBe(false);
    });

    it('carries allowAdditionalKeys true for a connector whose schema allows it', async () => {
      const service = createServiceStub();
      service.findSettings.mockResolvedValue(buildView({ allowAdditionalKeys: true }));
      const controller = new ConnectorsController(service);

      const response = await controller.get('http_request');

      expect(response.allowAdditionalKeys).toBe(true);
    });

    it('lets an unknown connector type surface as the service own 404', async () => {
      const service = createServiceStub();
      service.findSettings.mockRejectedValue(new ConnectorTypeNotFoundException());
      const controller = new ConnectorsController(service);

      await expect(controller.get('nope')).rejects.toThrow(ConnectorTypeNotFoundException);
    });
  });

  describe('replace', () => {
    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: UpdateConnectorSettingsRequestDto,
      data: '',
    };
    const validationPipe = new ValidationPipe({ whitelist: true, transform: true });

    it('rejects a body whose settings is not an object', async () => {
      await expect(
        validationPipe.transform({ settings: 'not-an-object' }, metadata),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a well-shaped settings map', async () => {
      const dto = (await validationPipe.transform(
        { settings: { apiKey: 'sk-live' } },
        metadata,
      )) as UpdateConnectorSettingsRequestDto;

      expect(dto.settings).toEqual({ apiKey: 'sk-live' });
    });

    it('resolves updated_by from the oid claim and forwards the validated settings', async () => {
      const service = createServiceStub();
      service.replaceSettings.mockResolvedValue(buildView());
      const controller = new ConnectorsController(service);
      const dto = new UpdateConnectorSettingsRequestDto();
      dto.settings = { apiKey: 'sk-live' };

      await controller.replace('sendgrid_email', dto, noReplaceQuery, {
        adminTokenClaims: { oid: 'operator-oid' },
      } as never);

      expect(service.replaceSettings).toHaveBeenCalledWith(
        'sendgrid_email',
        { apiKey: 'sk-live' },
        'operator-oid',
        false,
      );
    });

    it('falls back to the user principal name when oid is absent', async () => {
      const service = createServiceStub();
      service.replaceSettings.mockResolvedValue(buildView());
      const controller = new ConnectorsController(service);
      const dto = new UpdateConnectorSettingsRequestDto();
      dto.settings = { apiKey: 'sk-live' };

      await controller.replace('sendgrid_email', dto, noReplaceQuery, {
        adminTokenClaims: { preferred_username: 'operator@tsh.io' },
      } as never);

      expect(service.replaceSettings).toHaveBeenCalledWith(
        'sendgrid_email',
        { apiKey: 'sk-live' },
        'operator@tsh.io',
        false,
      );
    });

    it('resolves the unknown-actor constant with no adminTokenClaims on the request, without throwing', async () => {
      const service = createServiceStub();
      service.replaceSettings.mockResolvedValue(buildView());
      const controller = new ConnectorsController(service);
      const dto = new UpdateConnectorSettingsRequestDto();
      dto.settings = { apiKey: 'sk-live' };

      await controller.replace('sendgrid_email', dto, noReplaceQuery, {} as never);

      expect(service.replaceSettings).toHaveBeenCalledWith(
        'sendgrid_email',
        { apiKey: 'sk-live' },
        ADMIN_ACCESS_UNKNOWN_ACTOR,
        false,
      );
    });

    it('forwards `replace=true` from the query string as the opt-in flag', async () => {
      const service = createServiceStub();
      service.replaceSettings.mockResolvedValue(buildView());
      const controller = new ConnectorsController(service);
      const dto = new UpdateConnectorSettingsRequestDto();
      dto.settings = { apiKey: 'sk-live' };
      const query = new ReplaceConnectorSettingsQueryDto();
      query.replace = 'true';

      await controller.replace('sendgrid_email', dto, query, {} as never);

      expect(service.replaceSettings).toHaveBeenCalledWith(
        'sendgrid_email',
        { apiKey: 'sk-live' },
        ADMIN_ACCESS_UNKNOWN_ACTOR,
        true,
      );
    });
  });

  describe('remove', () => {
    it('answers 204, resolves the operator identity and calls through to the service', async () => {
      const service = createServiceStub();
      service.removeSettings.mockResolvedValue(undefined);
      const controller = new ConnectorsController(service);

      await expect(
        controller.remove('sendgrid_email', {
          adminTokenClaims: { oid: 'operator-oid' },
        } as never),
      ).resolves.toBeUndefined();
      expect(service.removeSettings).toHaveBeenCalledWith('sendgrid_email', 'operator-oid');

      const httpCode = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ConnectorsController.prototype.remove,
      ) as number | undefined;
      expect(httpCode).toBe(204);
    });

    it('resolves the unknown-actor constant with no adminTokenClaims on the request', async () => {
      const service = createServiceStub();
      service.removeSettings.mockResolvedValue(undefined);
      const controller = new ConnectorsController(service);

      await controller.remove('sendgrid_email', {} as never);

      expect(service.removeSettings).toHaveBeenCalledWith(
        'sendgrid_email',
        ADMIN_ACCESS_UNKNOWN_ACTOR,
      );
    });
  });
});
