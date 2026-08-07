import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListAuditQueryDto } from './list-audit.query.dto';

describe('ListAuditQueryDto', () => {
  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ListAuditQueryDto,
    data: '',
  };

  const validateQuery = (query: object) => {
    return validationPipe.transform(query, metadata) as Promise<ListAuditQueryDto>;
  };

  it('accepts all five exact-match filters and strict ISO date bounds', async () => {
    await expect(
      validateQuery({
        page: '2',
        limit: '5',
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        occurredFrom: '2026-07-20T00:00:00.000Z',
        occurredTo: '2026-07-21T23:59:59.000Z',
      }),
    ).resolves.toEqual({
      page: 2,
      limit: 5,
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.state_transition',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      occurredFrom: '2026-07-20T00:00:00.000Z',
      occurredTo: '2026-07-21T23:59:59.000Z',
    });
  });

  it('applies default pagination when page and limit are omitted', async () => {
    await expect(validateQuery({ actorType: 'system' })).resolves.toEqual({
      page: 1,
      limit: 20,
      actorType: 'system',
    });
  });

  it('rejects blank and overlong string filters', async () => {
    const invalidCases: object[] = [
      { actorType: '   ' },
      { actorType: 'a'.repeat(65) },
      { actorId: '   ' },
      { actorId: 'a'.repeat(256) },
      { action: '   ' },
      { action: 'a'.repeat(256) },
      { resourceType: '   ' },
      { resourceType: 'a'.repeat(65) },
      { resourceId: '   ' },
      { resourceId: 'a'.repeat(256) },
    ];

    for (const query of invalidCases) {
      await expect(validateQuery(query)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('rejects unknown and repeated query values', async () => {
    await expect(
      validateQuery({
        actorType: 'system',
        unexpected: 'value',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(validateQuery({ actorType: ['system', 'engine'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects invalid strict ISO date strings and reversed date bounds', async () => {
    const invalidCases: object[] = [
      { occurredFrom: 'not-a-date' },
      { occurredFrom: '2026-07-20' },
      { occurredTo: '2026-07-20T00:00:00.000' },
      { occurredTo: '2026-13-20T00:00:00.000Z' },
      { occurredFrom: '2026-07-22T00:00:00.000Z', occurredTo: '2026-07-21T00:00:00.000Z' },
    ];

    for (const query of invalidCases) {
      await expect(validateQuery(query)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('rejects invalid page and limit values', async () => {
    const invalidCases: object[] = [
      { page: 0 },
      { page: -1 },
      { page: 'abc' },
      { page: '   ' },
      { page: '1.5' },
      { page: '1.0' },
      { page: '1e2' },
      { page: '0x10' },
      { page: ['1'] },
      { page: ['1', '2'] },
      { limit: 0 },
      { limit: -5 },
      { limit: 'abc' },
      { limit: '   ' },
      { limit: '1.5' },
      { limit: '1.0' },
      { limit: '1e2' },
      { limit: '0x10' },
      { limit: ['10'] },
      { limit: ['10', '20'] },
      { limit: 101 },
    ];

    for (const query of invalidCases) {
      await expect(validateQuery(query)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
