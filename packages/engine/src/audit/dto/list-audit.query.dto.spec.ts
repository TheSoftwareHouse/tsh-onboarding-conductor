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

  const validateQuery = (query: Record<string, unknown>) => {
    return validationPipe.transform(query, metadata) as Promise<ListAuditQueryDto>;
  };

  it('accepts all five exact-match filters and strict ISO date bounds', async () => {
    await expect(
      validateQuery({
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        occurredFrom: '2026-07-20T00:00:00.000Z',
        occurredTo: '2026-07-21T23:59:59.000Z',
      }),
    ).resolves.toEqual({
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.state_transition',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      occurredFrom: '2026-07-20T00:00:00.000Z',
      occurredTo: '2026-07-21T23:59:59.000Z',
    });
  });

  it('rejects blank and overlong string filters', async () => {
    const invalidCases: Array<Record<string, unknown>> = [
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
    const invalidCases: Array<Record<string, unknown>> = [
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
});
