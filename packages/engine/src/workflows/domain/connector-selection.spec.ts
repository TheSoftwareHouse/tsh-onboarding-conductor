import type {
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowStep,
} from '@tsh/ddl-schema';
import type {
  ConnectorAdapterSummary,
  ConnectorExecutionPort,
} from '../../connectors/ports/connector-execution.port';
import {
  applyConnectorSelections,
  ConnectorSelectionRules,
  findSelectableConnector,
  WORKFLOW_CONNECTOR_SELECTION_INVALID_REASONS,
} from './connector-selection';

const connector = (
  id: string,
  order: number,
  overrides: Partial<NormalizedWorkflowConnectorDeclaration> = {},
): NormalizedWorkflowConnectorDeclaration => ({
  name: `${id}-name`,
  id,
  type: 'kyc',
  canReject: true,
  async: true,
  order,
  fieldMapping: { firstName: 'firstName' },
  optionalFieldMapping: {},
  config: { levelName: 'basic' },
  retry: { maxAttempts: 1, delayMs: 0 } as never,
  fallbacks: [],
  ...overrides,
});

const step = (
  name: string,
  connectors: readonly NormalizedWorkflowConnectorDeclaration[],
): NormalizedWorkflowStep => ({
  name,
  status: 'awaiting_user',
  data: {},
  connectors,
  transitions: [],
  terminal: false,
  scoring: [],
});

const buildDefinition = (
  steps: readonly NormalizedWorkflowStep[],
): NormalizedWorkflowDefinition => ({
  id: 'flow',
  version: 2,
  name: 'Flow',
  initial: steps[0].name,
  steps,
  stepsByName: Object.fromEntries(steps.map((entry) => [entry.name, entry])),
  scores: {},
  agreements: [],
});

describe('findSelectableConnector', () => {
  it('returns the single connector declaration of a step', () => {
    const only = connector('kyc_a', 1);

    expect(findSelectableConnector(step('kyc', [only]))).toBe(only);
  });

  it('returns undefined for a step without connectors', () => {
    expect(findSelectableConnector(step('plain', []))).toBeUndefined();
  });

  it('returns undefined for a step with more than one connector slot', () => {
    expect(
      findSelectableConnector(step('two', [connector('kyc_a', 1), connector('kyc_b', 2)])),
    ).toBeUndefined();
  });
});

describe('applyConnectorSelections', () => {
  it('returns the very same definition when there are no selections', () => {
    const definition = buildDefinition([step('kyc', [connector('kyc_a', 1)])]);

    expect(applyConnectorSelections(definition, [])).toBe(definition);
  });

  it('replaces only the primary id and keeps every other property', () => {
    const fallback = connector('kyc_fallback', 1);
    const primary = connector('kyc_a', 1, { fallbacks: [fallback], errorHandler: 'fail' });
    const definition = buildDefinition([step('kyc', [primary]), step('done', [])]);

    const effective = applyConnectorSelections(definition, [
      { stepName: 'kyc', connectorId: 'kyc_b' },
    ]);

    expect(effective.steps[0].connectors).toEqual([{ ...primary, id: 'kyc_b' }]);
    expect(effective.steps[0].connectors[0].fallbacks).toEqual([fallback]);
    expect(effective.steps[1]).toBe(definition.steps[1]);
    expect({ ...effective, steps: undefined, stepsByName: undefined }).toEqual({
      ...definition,
      steps: undefined,
      stepsByName: undefined,
    });
  });

  it('rebuilds stepsByName from the new steps and leaves the authored definition untouched', () => {
    const definition = buildDefinition([step('kyc', [connector('kyc_a', 1)])]);

    const effective = applyConnectorSelections(definition, [
      { stepName: 'kyc', connectorId: 'kyc_b' },
    ]);

    expect(effective.stepsByName.kyc).toBe(effective.steps[0]);
    expect(effective.stepsByName.kyc.connectors[0].id).toBe('kyc_b');
    expect(definition.steps[0].connectors[0].id).toBe('kyc_a');
  });

  it('ignores a selection naming a step the definition does not have', () => {
    const definition = buildDefinition([step('kyc', [connector('kyc_a', 1)])]);

    const effective = applyConnectorSelections(definition, [
      { stepName: 'missing', connectorId: 'kyc_b' },
    ]);

    expect(effective.steps[0]).toBe(definition.steps[0]);
  });

  it('leaves a two-slot step untouched', () => {
    const twoSlots = step('two', [connector('kyc_a', 1), connector('kyc_c', 2)]);
    const definition = buildDefinition([twoSlots]);

    const effective = applyConnectorSelections(definition, [
      { stepName: 'two', connectorId: 'kyc_b' },
    ]);

    expect(effective.steps[0]).toBe(twoSlots);
  });
});

describe('ConnectorSelectionRules', () => {
  const adapter = (
    id: string,
    overrides: Partial<ConnectorAdapterSummary> = {},
  ): ConnectorAdapterSummary => ({
    id,
    type: 'kyc',
    supportsAsyncCallback: true,
    scope: 'built-in',
    callbackFields: [],
    ...overrides,
  });
  const ADAPTERS: readonly ConnectorAdapterSummary[] = [
    adapter('kyc_a'),
    adapter('kyc_b'),
    adapter('fixture_kyc', { scope: 'fixtures' }),
    adapter('sync_kyc', { supportsAsyncCallback: false }),
    adapter('reporting_kyc', { callbackFields: ['kycOutcome'] }),
    adapter('smtp', { type: 'email_delivery' }),
  ];
  const PRODUCTION_SCOPES = ['built-in', 'users'] as const;
  const createRules = (
    scopes: readonly ('built-in' | 'fixtures' | 'users')[] = ['built-in', 'fixtures', 'users'],
    validateDeclarations: ConnectorExecutionPort['validateDeclarations'] = jest.fn(),
  ) => {
    const port: ConnectorExecutionPort = {
      execute: jest.fn(),
      resume: jest.fn(),
      listAdapters: () => ADAPTERS,
      validateDeclarations,
    };

    return { rules: new ConnectorSelectionRules(port, scopes), port };
  };
  const kycStep = (overrides: Partial<NormalizedWorkflowConnectorDeclaration> = {}) =>
    step('kyc', [connector('kyc_a', 1, overrides)]);

  describe('listSelectableAdapters', () => {
    it('keeps only the adapters whose scope is active', () => {
      expect(createRules(PRODUCTION_SCOPES).rules.listSelectableAdapters()).toEqual(
        ADAPTERS.filter((entry) => entry.id !== 'fixture_kyc'),
      );
      expect(createRules().rules.listSelectableAdapters()).toEqual(ADAPTERS);
    });

    it('lists nothing without a port, or with one that cannot list', () => {
      expect(new ConnectorSelectionRules(undefined, ['built-in']).listSelectableAdapters()).toEqual(
        [],
      );
      expect(
        new ConnectorSelectionRules({ execute: jest.fn(), resume: jest.fn() }, [
          'built-in',
        ]).listSelectableAdapters(),
      ).toEqual([]);
    });
  });

  describe('refuse', () => {
    it('declares every reason the exception can carry', () => {
      expect(WORKFLOW_CONNECTOR_SELECTION_INVALID_REASONS).toEqual([
        'no_connector',
        'multiple_connectors',
        'in_fallback_chain',
        'adapter_not_registered',
        'fixture_not_allowed',
        'type_mismatch',
        'async_unsupported',
        'callback_fields_missing',
        'declaration_invalid',
      ]);
    });

    it.each([
      ['no_connector', step('plain', []), 'kyc_b', undefined],
      [
        'multiple_connectors',
        step('two', [connector('kyc_a', 1), connector('kyc_b', 2)]),
        'kyc_b',
        undefined,
      ],
      [
        'in_fallback_chain',
        kycStep({ fallbacks: [connector('kyc_b', 1) as never] }),
        'kyc_b',
        undefined,
      ],
      ['adapter_not_registered', kycStep(), 'not_a_connector', undefined],
      ['fixture_not_allowed', kycStep(), 'fixture_kyc', PRODUCTION_SCOPES],
      ['type_mismatch', kycStep(), 'smtp', undefined],
      ['async_unsupported', kycStep(), 'sync_kyc', undefined],
      ['callback_fields_missing', kycStep(), 'reporting_kyc', undefined],
    ] as const)('refuses with %s', (reason, candidateStep, connectorId, scopes) => {
      const { rules } = createRules(scopes);

      expect(rules.refuse(candidateStep, connectorId)).toEqual(expect.objectContaining({ reason }));
    });

    it('names the missing callback field in the detail', () => {
      expect(createRules().rules.refuse(kycStep(), 'reporting_kyc')).toEqual({
        reason: 'callback_fields_missing',
        detail: 'the step does not declare "kycOutcome"',
      });
    });

    it("wraps the adapters' declaration refusal as declaration_invalid with its message", () => {
      const { rules, port } = createRules(undefined, () => {
        throw new Error('config.levelName is required');
      });
      const validateDeclarations = jest.spyOn(port, 'validateDeclarations');

      expect(rules.refuse(kycStep(), 'kyc_b')).toEqual({
        reason: 'declaration_invalid',
        detail: 'config.levelName is required',
      });
      expect(validateDeclarations).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'kyc_b', type: 'kyc', config: { levelName: 'basic' } }),
      ]);
    });

    it('accepts a sync-only adapter on a synchronous slot and an adapter whose fields the step declares', () => {
      const { rules } = createRules();
      const declaring = {
        ...kycStep(),
        data: { kycOutcome: { type: 'text', required: false } } as never,
      };

      expect(rules.refuse(kycStep({ async: false }), 'sync_kyc')).toBeUndefined();
      expect(rules.refuse(declaring, 'reporting_kyc')).toBeUndefined();
      expect(rules.refuse(kycStep(), 'kyc_b')).toBeUndefined();
    });
  });

  describe('listSelectableIds', () => {
    it('lists the authored and effective ids plus every adapter it would not refuse, sorted and unique', () => {
      const { rules } = createRules(PRODUCTION_SCOPES);

      expect(rules.listSelectableIds(kycStep(), 'kyc_a', 'zzz_selected')).toEqual([
        'kyc_a',
        'kyc_b',
        'zzz_selected',
      ]);
      expect(rules.listSelectableIds(kycStep(), 'kyc_a', 'kyc_a')).toEqual(['kyc_a', 'kyc_b']);
    });

    it('lists nothing for a step with no connector or more than one', () => {
      const { rules } = createRules();

      expect(rules.listSelectableIds(step('plain', []), 'kyc_a', 'kyc_a')).toEqual([]);
      expect(
        rules.listSelectableIds(
          step('two', [connector('kyc_a', 1), connector('kyc_b', 2)]),
          'kyc_a',
          'kyc_a',
        ),
      ).toEqual([]);
    });

    it('leaves out a chain id, and an adapter whose declaration rules throw, without throwing', () => {
      const chained = kycStep({ fallbacks: [connector('kyc_b', 1) as never] });
      const { rules } = createRules(PRODUCTION_SCOPES, (declarations) => {
        if (declarations[0].id === 'kyc_b') {
          throw new Error('config.levelName is required');
        }
      });

      expect(rules.listSelectableIds(chained, 'kyc_a', 'kyc_a')).toEqual(['kyc_a']);
      expect(rules.listSelectableIds(kycStep(), 'kyc_a', 'kyc_a')).toEqual(['kyc_a']);
    });

    it('keeps the authored and effective ids without a port', () => {
      expect(
        new ConnectorSelectionRules(undefined, []).listSelectableIds(kycStep(), 'kyc_a', 'kyc_b'),
      ).toEqual(['kyc_a', 'kyc_b']);
    });
  });
});
