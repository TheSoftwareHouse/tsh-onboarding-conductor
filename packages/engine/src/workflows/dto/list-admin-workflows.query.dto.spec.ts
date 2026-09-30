import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListAdminWorkflowsQueryDto } from './list-admin-workflows.query.dto';

describe('ListAdminWorkflowsQueryDto', () => {
  const validationPipe = new ValidationPipe({ whitelist: true, transform: true });

  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ListAdminWorkflowsQueryDto,
    data: '',
  };

  const validateQuery = (query: object) =>
    validationPipe.transform(query, metadata) as Promise<ListAdminWorkflowsQueryDto>;

  it('applies the default page window when page and limit are omitted', async () => {
    await expect(validateQuery({})).resolves.toEqual(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it('keeps the page window alongside the filter criteria', async () => {
    const result = await validateQuery({
      page: '2',
      limit: '50',
      search: 'kyc',
      scope: 'users',
      hasDraft: 'true',
    });

    expect(result).toEqual(
      expect.objectContaining({
        page: 2,
        limit: 50,
        search: 'kyc',
        scope: 'users',
        hasDraft: true,
      }),
    );
  });

  it('trims the search text', async () => {
    const result = await validateQuery({ search: '  kyc  ' });

    expect(result.search).toBe('kyc');
  });

  it('rejects a blank search', async () => {
    await expect(validateQuery({ search: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a search text over 100 characters', async () => {
    await expect(validateQuery({ search: 'a'.repeat(101) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each(['built-in', 'fixtures', 'users'])('accepts %s as a scope', async (scope) => {
    await expect(validateQuery({ scope })).resolves.toEqual(expect.objectContaining({ scope }));
  });

  it('rejects an unknown scope', async () => {
    await expect(validateQuery({ scope: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['true', 'false'])('converts the literal %s into a boolean', async (hasDraft) => {
    const result = await validateQuery({ hasDraft });

    expect(result.hasDraft).toBe(hasDraft === 'true');
  });

  it.each(['yes', '1', '', 'TRUE'])('rejects %j as hasDraft', async (hasDraft) => {
    await expect(validateQuery({ hasDraft })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a limit above the shared maximum so one request cannot scan the table', async () => {
    await expect(validateQuery({ limit: '101' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
