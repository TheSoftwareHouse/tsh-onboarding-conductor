import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ClearWorkflowConnectorQueryDto } from './clear-workflow-connector.query.dto';
import { SelectWorkflowConnectorRequestDto } from './select-workflow-connector.request.dto';

describe('connector selection scope DTOs', () => {
  const validationPipe = new ValidationPipe({ whitelist: true, transform: true });

  describe('ClearWorkflowConnectorQueryDto', () => {
    const metadata: ArgumentMetadata = {
      type: 'query',
      metatype: ClearWorkflowConnectorQueryDto,
      data: '',
    };

    const validate = (query: object) =>
      validationPipe.transform(query, metadata) as Promise<ClearWorkflowConnectorQueryDto>;

    it('converts a version query string to a number', async () => {
      await expect(validate({ scope: 'version', version: '2' })).resolves.toEqual(
        expect.objectContaining({ scope: 'version', version: 2 }),
      );
    });

    it('accepts the all scope without a version', async () => {
      await expect(validate({ scope: 'all' })).resolves.toEqual(
        expect.objectContaining({ scope: 'all' }),
      );
    });

    it.each([
      ['a missing scope', {}],
      ['an unknown scope', { scope: 'some' }],
      ['the version scope without a version', { scope: 'version' }],
      ['the version scope with version 0', { scope: 'version', version: '0' }],
      ['the version scope with a fractional version', { scope: 'version', version: '1.5' }],
      ['the all scope with a version', { scope: 'all', version: '1' }],
    ])('rejects %s', async (_label, query) => {
      await expect(validate(query)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('SelectWorkflowConnectorRequestDto', () => {
    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: SelectWorkflowConnectorRequestDto,
      data: '',
    };

    const validate = (body: object) =>
      validationPipe.transform(body, metadata) as Promise<SelectWorkflowConnectorRequestDto>;

    const connectorId = 'mock_kyc_2';

    it('accepts the version scope with a numeric version', async () => {
      await expect(validate({ connectorId, scope: 'version', version: 2 })).resolves.toEqual(
        expect.objectContaining({ scope: 'version', version: 2 }),
      );
    });

    it('accepts the all scope without a version', async () => {
      await expect(validate({ connectorId, scope: 'all' })).resolves.toEqual(
        expect.objectContaining({ scope: 'all' }),
      );
    });

    it.each([
      ['a missing scope', {}],
      ['an unknown scope', { scope: 'some' }],
      ['the version scope without a version', { scope: 'version' }],
      ['the version scope with version 0', { scope: 'version', version: 0 }],
      ['the version scope with a fractional version', { scope: 'version', version: 1.5 }],
      ['the all scope with a version', { scope: 'all', version: 1 }],
    ])('rejects %s', async (_label, body) => {
      await expect(validate({ connectorId, ...body })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
