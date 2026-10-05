import type {
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowStep,
} from '@tsh/ddl-schema';
import { applyConnectorSelections, findSelectableConnector } from './connector-selection';

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
