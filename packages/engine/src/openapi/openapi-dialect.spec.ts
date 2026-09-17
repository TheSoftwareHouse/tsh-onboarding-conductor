import { toOpenApi31Dialect } from './openapi-dialect';

describe('toOpenApi31Dialect', () => {
  it('turns a nullable primitive into a type list', () => {
    expect(toOpenApi31Dialect({ type: 'string', nullable: true, description: 'x' })).toEqual({
      type: ['string', 'null'],
      description: 'x',
    });
  });

  it('adds null to a nullable enum so the null arm is reachable', () => {
    expect(toOpenApi31Dialect({ type: 'string', enum: ['a', 'b'], nullable: true })).toEqual({
      type: ['string', 'null'],
      enum: ['a', 'b', null],
    });
  });

  it('wraps a nullable reference in a oneOf, keeping the description outside', () => {
    expect(
      toOpenApi31Dialect({
        nullable: true,
        type: 'object',
        allOf: [{ $ref: '#/components/schemas/Thing' }],
        description: 'd',
      }),
    ).toEqual({
      description: 'd',
      oneOf: [
        { type: 'object', allOf: [{ $ref: '#/components/schemas/Thing' }] },
        { type: 'null' },
      ],
    });
  });

  it('recurses through objects and arrays and leaves everything else untouched', () => {
    const input = {
      paths: {
        '/x': { get: { responses: { 200: { schema: { type: 'string', nullable: true } } } } },
      },
      list: [{ type: 'integer' }, { type: 'boolean', nullable: true }],
      untouched: { type: 'object', properties: { a: { type: 'string' } } },
    };

    expect(toOpenApi31Dialect(input)).toEqual({
      paths: { '/x': { get: { responses: { 200: { schema: { type: ['string', 'null'] } } } } } },
      list: [{ type: 'integer' }, { type: ['boolean', 'null'] }],
      untouched: { type: 'object', properties: { a: { type: 'string' } } },
    });
  });

  it('does not mistake a property named nullable for the keyword', () => {
    const input = { type: 'object', properties: { nullable: { type: 'boolean' } } };

    expect(toOpenApi31Dialect(input)).toEqual(input);
  });
});
