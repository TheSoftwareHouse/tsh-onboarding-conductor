import { ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, ValidateNested } from 'class-validator';
import { validate, ValidationError } from 'class-validator';
import { ValidationFailedException } from './validation-failed.exception';

class NestedSampleDto {
  @IsNotEmpty()
  name!: string;
}

class SampleDto {
  @IsNotEmpty()
  requiredField!: string;

  @IsInt()
  count!: number;

  @IsIn(['a', 'b', 'c'])
  choice!: string;

  @ValidateNested()
  @Type(() => NestedSampleDto)
  nested!: NestedSampleDto;
}

async function buildValidationErrors(): Promise<ValidationError[]> {
  const instance = plainToInstance(SampleDto, {
    requiredField: '',
    count: 'not-a-number',
    choice: 'invalid-choice',
    nested: { name: '' },
  });

  return validate(instance);
}

describe('ValidationFailedException', () => {
  it("produces a response body byte-identical to Nest's current ValidationPipe default", async () => {
    const validationErrors = await buildValidationErrors();

    // Nest's own default exceptionFactory - the ground truth this exception must reproduce.
    const nestDefaultException = new ValidationPipe().createExceptionFactory()(
      validationErrors,
    ) as {
      getResponse(): unknown;
      getStatus(): number;
    };

    const exception = new ValidationFailedException(validationErrors);

    expect(exception.getResponse()).toEqual(nestDefaultException.getResponse());
    expect(exception.getStatus()).toBe(nestDefaultException.getStatus());
    expect(exception.getResponse()).toEqual({
      message: expect.any(Array),
      error: 'Bad Request',
      statusCode: 400,
    });
  });

  it('exposes fieldErrors as constraint keys, never messages, with dot-joined nested paths', async () => {
    const validationErrors = await buildValidationErrors();

    const exception = new ValidationFailedException(validationErrors);

    expect(exception.fieldErrors.requiredField).toEqual(['isNotEmpty']);
    expect(exception.fieldErrors.count).toEqual(['isInt']);
    expect(exception.fieldErrors.choice).toEqual(['isIn']);
    expect(exception.fieldErrors['nested.name']).toEqual(['isNotEmpty']);

    const serializedFieldErrors = JSON.stringify(exception.fieldErrors);
    expect(serializedFieldErrors).not.toContain('a, b, c');
    expect(serializedFieldErrors).not.toContain('must be one of the following values');
    expect(serializedFieldErrors).not.toContain('must not be empty');
  });
});
