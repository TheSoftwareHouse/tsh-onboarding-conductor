import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AzureJwtGuard } from '../auth/azure-jwt.guard';
import { AgreementsController } from './agreements.controller';
import type { AgreementsService, PublishedAgreement } from './agreements.service';
import { ListAgreementsQueryDto } from './dto/list-agreements.query.dto';
import { PublishAgreementRequestDto } from './dto/publish-agreement.request.dto';
import { AgreementEntity } from './entity/agreement.entity';
import { AgreementVersionEntity } from './entity/agreement-version.entity';

const KEY = 'eu-b2c-terms';

const createAgreement = (version: number) =>
  Object.assign(new AgreementVersionEntity(), {
    agreementVersionId: `01912345-6789-7abc-8def-00000000000${version}`,
    agreementId: '01912345-6789-7abc-8def-0000000000a1',
    version,
    publishedAt: new Date('2026-02-01T00:00:00.000Z'),
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    agreement: Object.assign(new AgreementEntity(), {
      id: '01912345-6789-7abc-8def-0000000000a1',
      key: KEY,
      type: 'terms_and_conditions',
    }),
  });

const createServiceStub = (): jest.Mocked<AgreementsService> =>
  ({
    publish: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    findLatestForKeys: jest.fn(),
    linkPending: jest.fn(),
  }) as unknown as jest.Mocked<AgreementsService>;

const createRequest = (claims?: Record<string, unknown>) =>
  ({ adminTokenClaims: claims }) as unknown as Request & {
    adminTokenClaims?: Record<string, unknown>;
  };

const validate = async (dto: object, metatype: ArgumentMetadata['metatype']) =>
  new ValidationPipe({ whitelist: true, transform: true }).transform(dto, {
    type: 'body',
    metatype,
  });

describe('AgreementsController', () => {
  it('carries AzureJwtGuard on every route', () => {
    for (const method of ['publish', 'list'] as const) {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        AgreementsController.prototype[method],
      ) as unknown[] | undefined;

      expect(guards).toEqual([AzureJwtGuard]);
    }
  });

  describe('publish', () => {
    it('publishes under the operator behind the token and reports the fan-out it caused', async () => {
      const service = createServiceStub();
      const published: PublishedAgreement = {
        agreement: createAgreement(2),
        linkedOnboardings: 3,
      };
      service.publish.mockResolvedValue(published);
      const controller = new AgreementsController(service);
      const dto = Object.assign(new PublishAgreementRequestDto(), {
        key: KEY,
        type: 'terms_and_conditions' as const,
      });

      const response = await controller.publish(dto, createRequest({ oid: 'operator-oid' }));

      expect(service.publish).toHaveBeenCalledWith(KEY, 'terms_and_conditions', 'operator-oid');
      expect(response).toEqual({
        id: published.agreement.agreementVersionId,
        key: KEY,
        type: 'terms_and_conditions',
        version: 2,
        publishedAt: '2026-02-01T00:00:00.000Z',
        linkedOnboardings: 3,
      });
    });

    it('names the unknown actor when the guard established no identity', async () => {
      const service = createServiceStub();
      service.publish.mockResolvedValue({
        agreement: createAgreement(1),
        linkedOnboardings: 0,
      });
      const controller = new AgreementsController(service);
      const dto = Object.assign(new PublishAgreementRequestDto(), {
        key: KEY,
        type: 'terms_and_conditions' as const,
      });

      await controller.publish(dto, createRequest(undefined));

      expect(service.publish).toHaveBeenCalledWith(
        KEY,
        'terms_and_conditions',
        ADMIN_ACCESS_UNKNOWN_ACTOR,
      );
    });

    it.each([
      ['a key outside the identifier shape', { key: 'EU B2C Terms', type: 'terms_and_conditions' }],
      ['a type outside the declared classifications', { key: KEY, type: 'marketing_consent' }],
      ['a missing key', { type: 'terms_and_conditions' }],
    ])('rejects %s', async (_case, body) => {
      await expect(validate(body, PublishAgreementRequestDto)).rejects.toThrow(BadRequestException);
    });

    it('drops a name, which no agreement carries', async () => {
      const dto = await validate(
        { key: KEY, type: 'terms_and_conditions', name: 'Terms & Conditions' },
        PublishAgreementRequestDto,
      );

      expect(dto).toEqual({ key: KEY, type: 'terms_and_conditions' });
    });
  });

  describe('list', () => {
    it('reports one page of published versions with the shared meta envelope', async () => {
      const service = createServiceStub();
      service.list.mockResolvedValue({
        items: [createAgreement(2), createAgreement(1)],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      const controller = new AgreementsController(service);
      const query = Object.assign(new ListAgreementsQueryDto(), { key: KEY });

      const response = await controller.list(query);

      expect(service.list).toHaveBeenCalledWith(query);
      expect(response.items.map((item) => item.version)).toEqual([2, 1]);
      expect(response.meta).toEqual({
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      });
    });

    it('rejects a type filter outside the declared classifications', async () => {
      await expect(
        new ValidationPipe({ whitelist: true, transform: true }).transform(
          { type: 'marketing_consent' },
          { type: 'query', metatype: ListAgreementsQueryDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
