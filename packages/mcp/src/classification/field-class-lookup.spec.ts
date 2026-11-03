import { EngineClient } from '../engine/engine-client';
import { EngineError } from '../engine/engine-error';
import { FieldClass } from '../masking/masking.constants';
import { FieldClassifier } from '../masking/field-classifier';
import type { FieldClassMap } from '../masking/masking.types';
import { RequestContext } from '../request-context/request-context';
import { Logger } from '@nestjs/common';
import { FieldClassLookup } from './field-class-lookup';
import { ANALYST_INVESTIGATION_COMPILED } from './testing/analyst-investigation.fixture';

const CONTEXT: RequestContext = {
  identity: { kind: 'user', objectId: 'oid-1', upn: 'analyst@example.com' },
  engineToken: 'engine-token-value',
};
const DOCUMENT_PATH = '/v1/admin/workflows/{workflowId}/versions/{version}/document';
const COMPILE_PATH = '/v1/admin/workflows/compile';
const COMPILE_REJECTED = 400;
const ENGINE_FAILED = 500;

type Definition = { steps: Array<{ data: Record<string, unknown> }> };

describe('FieldClassLookup', () => {
  let request: jest.Mock;
  let lookup: FieldClassLookup;
  let statuses: Record<number, string>;
  let definitions: Record<number, Definition | EngineError>;

  const ANALYST = { workflowId: 'analyst-investigation', version: 1 };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    statuses = { 1: 'published', 2: 'published' };
    definitions = { 1: ANALYST_INVESTIGATION_COMPILED, 2: ANALYST_INVESTIGATION_COMPILED };
    request = jest.fn((method: string, path: string, _context: RequestContext, args) => {
      if (path === DOCUMENT_PATH) {
        const { workflowId, version } = args.path;
        return Promise.resolve({
          workflowId,
          version,
          status: statuses[version],
          document: { id: workflowId, version },
        });
      }
      const definition = definitions[args.body.version];
      return definition instanceof EngineError
        ? Promise.reject(definition)
        : Promise.resolve({ definition });
    });
    lookup = new FieldClassLookup(
      { request } as unknown as EngineClient,
      new FieldClassifier(['country', 'nationality']),
    );
  });

  function declare(...fields: Array<[string, unknown]>): Definition {
    return { steps: [{ data: Object.fromEntries(fields) }] };
  }

  function classOf(classes: FieldClassMap, name: string): unknown {
    return classes.get(name);
  }

  it('classifies the compiled definition, not the authored document', async () => {
    const { classes, compileFailure } = await lookup.getVersionClasses(ANALYST, CONTEXT);

    expect(compileFailure).toBeUndefined();
    expect(classOf(classes, 'firstName')).toEqual({ class: FieldClass.DROP });
    expect(classOf(classes, 'dateOfBirth')).toEqual({ class: FieldClass.GENERALISE });
    expect(classOf(classes, 'email')).toEqual({ class: FieldClass.PSEUDONYMISE, format: 'email' });
    expect(classOf(classes, 'phoneNumber')).toEqual({
      class: FieldClass.PSEUDONYMISE,
      format: 'phone',
    });
    expect(classOf(classes, 'country')).toEqual({ class: FieldClass.PASS });
    expect(classOf(classes, 'accountPurpose')).toEqual({ class: FieldClass.PASS });
    expect(classOf(classes, 'pepSelfDeclared')).toEqual({ class: FieldClass.PASS });
    expect(classOf(classes, 'occupationTitle')).toEqual({ class: FieldClass.DROP });
    expect(classOf(classes, 'identityDocument')).toEqual({ class: FieldClass.DROP });
    expect(classOf(classes, 'verificationCode')).toEqual({ class: FieldClass.DROP });
  });

  it('fetches the stored document and posts it to the compile route as the caller', async () => {
    await lookup.getVersionClasses(ANALYST, CONTEXT);

    expect(request).toHaveBeenNthCalledWith(1, 'get', DOCUMENT_PATH, CONTEXT, { path: ANALYST });
    expect(request).toHaveBeenNthCalledWith(2, 'post', COMPILE_PATH, CONTEXT, {
      body: { id: 'analyst-investigation', version: 1 },
    });
  });

  it.each(['published', 'retired'])('fetches a %s version once across calls', async (status) => {
    statuses[1] = status;

    const first = await lookup.getVersionClasses(ANALYST, CONTEXT);
    const second = await lookup.getVersionClasses(ANALYST, CONTEXT);

    expect(second).toBe(first);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight fetch between concurrent calls for the same version', async () => {
    const [first, second] = await Promise.all([
      lookup.getVersionClasses(ANALYST, CONTEXT),
      lookup.getVersionClasses(ANALYST, CONTEXT),
    ]);

    expect(second).toBe(first);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never caches a draft', async () => {
    statuses[1] = 'draft';

    await lookup.getVersionClasses(ANALYST, CONTEXT);
    await lookup.getVersionClasses(ANALYST, CONTEXT);

    expect(request).toHaveBeenCalledTimes(4);
  });

  it('reports a version that does not compile and classifies nothing', async () => {
    definitions[1] = new EngineError('Not valid (400)', COMPILE_REJECTED, 'WORKFLOW_INVALID');

    const { classes, compileFailure } = await lookup.getVersionClasses(ANALYST, CONTEXT);

    expect(classes.size).toBe(0);
    expect(compileFailure).toBe('Not valid (400)');
  });

  it('retries a version that failed to compile instead of caching the failure', async () => {
    definitions[1] = new EngineError('Not valid (400)', COMPILE_REJECTED);
    await lookup.getVersionClasses(ANALYST, CONTEXT);

    definitions[1] = ANALYST_INVESTIGATION_COMPILED;
    const { classes, compileFailure } = await lookup.getVersionClasses(ANALYST, CONTEXT);

    expect(compileFailure).toBeUndefined();
    expect(classes.size).toBeGreaterThan(0);
  });

  it('throws any other engine failure and does not cache it', async () => {
    definitions[1] = new EngineError('The engine answered 500', ENGINE_FAILED);

    await expect(lookup.getVersionClasses(ANALYST, CONTEXT)).rejects.toThrow(
      'The engine answered 500',
    );

    definitions[1] = ANALYST_INVESTIGATION_COMPILED;
    await expect(lookup.getVersionClasses(ANALYST, CONTEXT)).resolves.toBeDefined();
  });

  describe('getMergedClasses', () => {
    it('takes the stricter class when versions declare a field differently', async () => {
      definitions[1] = declare(['region', { type: 'text', validation: { oneOf: ['eu', 'us'] } }]);
      definitions[2] = declare(['region', { type: 'text', validation: { maxLength: 50 } }]);

      const { classes, failures } = await lookup.getMergedClasses(
        [ANALYST, { ...ANALYST, version: 2 }],
        CONTEXT,
      );

      expect(classOf(classes, 'region')).toEqual({ class: FieldClass.DROP });
      expect(failures).toEqual([]);
    });

    it('lists the versions that did not compile and still merges the rest', async () => {
      definitions[1] = declare(['active', { type: 'boolean' }]);
      definitions[2] = new EngineError('Not valid (400)', COMPILE_REJECTED);

      const { classes, failures } = await lookup.getMergedClasses(
        [ANALYST, { ...ANALYST, version: 2 }],
        CONTEXT,
      );

      expect(classOf(classes, 'active')).toEqual({ class: FieldClass.PASS });
      expect(failures).toEqual([{ ...ANALYST, version: 2, reason: 'Not valid (400)' }]);
    });
  });

  describe('getCsvColumnClasses', () => {
    it('classifies each header by the field behind it and drops the unexplained', async () => {
      const { columns, failures } = await lookup.getCsvColumnClasses(
        ['Status', 'Email', 'First name', 'Risk score', 'Other data', 'Mystery'],
        [ANALYST],
        CONTEXT,
      );

      expect(columns.get('Status')).toEqual({ class: FieldClass.PASS });
      expect(columns.get('Email')).toEqual({ class: FieldClass.PSEUDONYMISE, format: 'email' });
      expect(columns.get('First name')).toEqual({ class: FieldClass.DROP });
      expect(columns.get('Risk score')).toEqual({ class: FieldClass.PASS, numericOnly: true });
      expect(columns.get('Other data')).toEqual({ class: FieldClass.DROP });
      expect(columns.get('Mystery')).toEqual({ class: FieldClass.DROP });
      expect(failures).toEqual([]);
    });
  });
});
