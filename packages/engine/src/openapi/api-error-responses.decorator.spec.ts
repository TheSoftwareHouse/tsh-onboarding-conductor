import { ConflictException, HttpStatus, NotFoundException } from '@nestjs/common';
import {
  ApiErrorResponses,
  VALIDATION_ERROR,
  describeApiError,
  frameworkError,
} from './api-error-responses.decorator';

class ThingNotFoundException extends NotFoundException {
  static readonly apiDescription = 'No thing has this id.';

  constructor() {
    super({ code: 'THING_NOT_FOUND', message: 'THING_NOT_FOUND' });
  }
}

class ThingBusyException extends ConflictException {
  constructor(reason: string) {
    super({ code: 'THING_BUSY', message: 'THING_BUSY', reason });
  }
}

class ThingGoneException extends ConflictException {
  constructor() {
    super({ code: 'THING_GONE', message: 'THING_GONE' });
  }
}

class BareException extends NotFoundException {
  constructor() {
    super('nope');
  }
}

type ResponseMetadata = Record<string, { description: string; schema: unknown }>;

function responsesOf(decorator: MethodDecorator): ResponseMetadata {
  class Controller {
    handle(): void {}
  }

  const descriptor = Object.getOwnPropertyDescriptor(Controller.prototype, 'handle')!;
  decorator(Controller.prototype, 'handle', descriptor);

  // The swagger package keys its response metadata as 'swagger/apiResponse'; found by suffix so the
  // spec does not import a deep path of the library.
  const key = Reflect.getMetadataKeys(Controller.prototype.handle).find((candidate) =>
    String(candidate).endsWith('/apiResponse'),
  );

  return Reflect.getMetadata(key, Controller.prototype.handle);
}

describe('describeApiError', () => {
  it('reads status, code and description off a constructed instance', () => {
    expect(describeApiError(ThingNotFoundException)).toEqual({
      status: HttpStatus.NOT_FOUND,
      code: 'THING_NOT_FOUND',
      description: 'No thing has this id.',
    });
  });

  it('passes constructor arguments and lets the source override the description', () => {
    expect(
      describeApiError({ exception: ThingBusyException, args: ['locked'], description: 'Busy.' }),
    ).toEqual({ status: HttpStatus.CONFLICT, code: 'THING_BUSY', description: 'Busy.' });
  });

  it('refuses a class whose payload carries no code', () => {
    expect(() => describeApiError(BareException)).toThrow(TypeError);
  });
});

describe('ApiErrorResponses', () => {
  it('declares one response per status with the codes that status can carry', () => {
    const responses = responsesOf(
      ApiErrorResponses(ThingNotFoundException, ThingGoneException, {
        exception: ThingBusyException,
        args: ['locked'],
      }),
    );

    expect(Object.keys(responses)).toEqual(['404', '409']);
    expect(responses['404'].description).toBe('`THING_NOT_FOUND`: No thing has this id.');
    expect(responses['409'].description).toBe('`THING_GONE`\n\n`THING_BUSY`');
    expect(responses['409'].schema).toEqual({
      allOf: [
        { $ref: '#/components/schemas/ApiError' },
        {
          type: 'object',
          properties: { code: { type: 'string', enum: ['THING_GONE', 'THING_BUSY'] } },
        },
      ],
    });
  });

  it('documents a framework refusal with the framework envelope', () => {
    const responses = responsesOf(ApiErrorResponses(frameworkError(401, 'No token.')));

    expect(responses['401']).toEqual(
      expect.objectContaining({
        description: 'No token.',
        schema: { $ref: '#/components/schemas/NestHttpError' },
      }),
    );
  });

  it('offers either envelope when the framework and the handler share a status', () => {
    class ThingInvalidException extends ConflictException {
      constructor() {
        super({ code: 'THING_INVALID', message: 'THING_INVALID' });
      }
    }
    const responses = responsesOf(
      ApiErrorResponses(
        VALIDATION_ERROR,
        frameworkError(409, 'Framework 409.'),
        ThingInvalidException,
      ),
    );

    expect(responses['400'].schema).toEqual({ $ref: '#/components/schemas/NestHttpError' });
    expect(responses['409'].description).toBe('Framework 409.\n\n`THING_INVALID`');
    expect(responses['409'].schema).toEqual({
      oneOf: [
        { $ref: '#/components/schemas/NestHttpError' },
        {
          allOf: [
            { $ref: '#/components/schemas/ApiError' },
            { type: 'object', properties: { code: { type: 'string', enum: ['THING_INVALID'] } } },
          ],
        },
      ],
    });
  });

  it('lists a code once however many sources name it', () => {
    const responses = responsesOf(ApiErrorResponses(ThingGoneException, ThingGoneException));

    expect(responses['409'].schema).toEqual(
      expect.objectContaining({
        allOf: expect.arrayContaining([
          { type: 'object', properties: { code: { type: 'string', enum: ['THING_GONE'] } } },
        ]),
      }),
    );
  });
});
