import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListAdminOnboardingsQueryDto } from './list-admin-onboardings.query.dto';

describe('ListAdminOnboardingsQueryDto', () => {
  // Mirrors the globally registered pipe from `createApp`, which notably does not enable
  // implicit conversion: the inherited page/limit transform has to do the numeric coercion
  // itself, so the endpoint cannot rely on the audit endpoint's looser local pipe.
  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
  });

  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ListAdminOnboardingsQueryDto,
    data: '',
  };

  const validateQuery = (query: object) =>
    validationPipe.transform(query, metadata) as Promise<ListAdminOnboardingsQueryDto>;

  it('applies the default page window when page and limit are omitted', async () => {
    await expect(validateQuery({})).resolves.toEqual(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it('converts a decimal-integer page window from its query string form', async () => {
    const result = await validateQuery({ page: '3', limit: '50' });

    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });

  it('keeps the page window alongside the filter criteria', async () => {
    const result = await validateQuery({
      page: '2',
      limit: '100',
      status: 'approved',
      workflowId: 'passport-check',
      workflowVersion: '3',
      currentStep: 'confirm_identity',
      onboardingId: '01912345-6789-7abc-8def-0123456789ab',
    });

    expect(result).toEqual(
      expect.objectContaining({
        page: 2,
        limit: 100,
        status: 'approved',
        workflowId: 'passport-check',
        workflowVersion: 3,
        currentStep: 'confirm_identity',
        onboardingId: '01912345-6789-7abc-8def-0123456789ab',
      }),
    );
  });

  it.each([
    { page: 0 },
    { page: -1 },
    { page: 'abc' },
    { page: '   ' },
    { page: '' },
    { page: '1.5' },
    { page: '1e2' },
    { page: '0x10' },
    { page: 'Infinity' },
    { page: ['1', '2'] },
    { limit: 0 },
    { limit: -5 },
    { limit: 'abc' },
    { limit: '' },
    { limit: '1.5' },
    { limit: ['10', '20'] },
  ])('rejects %j through validation', async (query) => {
    await expect(validateQuery(query)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a limit above the shared maximum so one request cannot scan the table', async () => {
    await expect(validateQuery({ limit: '101' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ListAdminOnboardingsQueryDto score filtering and sorting', () => {
  const validationPipe = new ValidationPipe({ whitelist: true, transform: true });
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ListAdminOnboardingsQueryDto,
    data: '',
  };
  const validateQuery = (query: object) =>
    validationPipe.transform(query, metadata) as Promise<ListAdminOnboardingsQueryDto>;

  it('coerces score bounds arriving as query-string numbers', async () => {
    await expect(validateQuery({ minScore: '40', maxScore: '80' })).resolves.toEqual(
      expect.objectContaining({ minScore: 40, maxScore: 80 }),
    );
  });

  it('accepts score bounds already given as numbers', async () => {
    await expect(validateQuery({ minScore: 40, maxScore: 80 })).resolves.toEqual(
      expect.objectContaining({ minScore: 40, maxScore: 80 }),
    );
  });

  it('accepts a negative bound, because a score may legitimately be below zero', async () => {
    await expect(validateQuery({ minScore: '-30' })).resolves.toEqual(
      expect.objectContaining({ minScore: -30 }),
    );
  });

  it('rejects a non-integer score bound', async () => {
    await expect(validateQuery({ minScore: 'abc' })).rejects.toThrow(BadRequestException);
    await expect(validateQuery({ maxScore: '12.5' })).rejects.toThrow(BadRequestException);
  });

  it('accepts the declared sort fields and directions', async () => {
    await expect(validateQuery({ sortBy: 'score', sortDir: 'asc' })).resolves.toEqual(
      expect.objectContaining({ sortBy: 'score', sortDir: 'asc' }),
    );
    await expect(validateQuery({ sortBy: 'createdAt', sortDir: 'desc' })).resolves.toEqual(
      expect.objectContaining({ sortBy: 'createdAt', sortDir: 'desc' }),
    );
    await expect(validateQuery({ sortBy: 'completedAt', sortDir: 'asc' })).resolves.toEqual(
      expect.objectContaining({ sortBy: 'completedAt', sortDir: 'asc' }),
    );
  });

  it('rejects an unknown sort field or direction', async () => {
    await expect(validateQuery({ sortBy: 'context' })).rejects.toThrow(BadRequestException);
    await expect(validateQuery({ sortDir: 'sideways' })).rejects.toThrow(BadRequestException);
  });

  it('leaves the query untouched when none of the four is given', async () => {
    const query = await validateQuery({});

    expect(query.minScore).toBeUndefined();
    expect(query.maxScore).toBeUndefined();
    expect(query.sortBy).toBeUndefined();
    expect(query.sortDir).toBeUndefined();
  });
});
