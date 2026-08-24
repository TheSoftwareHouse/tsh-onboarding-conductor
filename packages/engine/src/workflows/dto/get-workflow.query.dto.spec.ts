import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { GetWorkflowQueryDto } from './get-workflow.query.dto';

describe('GetWorkflowQueryDto', () => {
  // Mirrors the globally registered pipe from `createApp`, which notably does not enable implicit
  // conversion: the transform on `version` has to do the numeric coercion itself.
  const validationPipe = new ValidationPipe({ whitelist: true, transform: true });

  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: GetWorkflowQueryDto,
    data: '',
  };

  const validateQuery = (query: object) =>
    validationPipe.transform(query, metadata) as Promise<GetWorkflowQueryDto>;

  it('leaves the version unset when it was not asked for', async () => {
    await expect(validateQuery({})).resolves.toEqual({});
  });

  it('converts a decimal-integer version from its query string form', async () => {
    await expect(validateQuery({ version: '3' })).resolves.toEqual({ version: 3 });
  });

  it.each([
    { version: '0' },
    { version: '-1' },
    { version: '1.5' },
    { version: '1e3' },
    { version: '0x2' },
    { version: '' },
    { version: ['1', '2'] },
  ])('refuses %o', async (query) => {
    await expect(validateQuery(query)).rejects.toThrow(BadRequestException);
  });
});
