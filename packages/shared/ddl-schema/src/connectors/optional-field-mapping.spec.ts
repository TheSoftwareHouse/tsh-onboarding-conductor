import { validateAndNormalizeUntypedSteps } from '../testing/untyped-steps.helper';
import { WorkflowInvalidError } from '../workflow-validator';

/**
 * A capture step reachable on only one branch: the shape an "either this document or that one"
 * workflow needs, and the one the dominator rule refuses for a required mapping.
 */
const buildWorkflow = (
  mapping: {
    fieldMapping: Record<string, string>;
    optionalFieldMapping?: Record<string, string>;
    fallback?: Record<string, unknown>[];
  },
  branchFieldOverrides: Record<string, unknown> = {},
) => ({
  id: 'branching',
  version: 1,
  name: 'Branching',
  initial: 'choose',
  steps: [
    {
      name: 'choose',
      status: 'awaiting_user',
      data: { pick: { type: 'text', required: true, validation: { oneOf: ['LEFT', 'RIGHT'] } } },
      transitions: [
        { status: 'success', when: { field: 'pick', equals: 'LEFT' }, target: 'left' },
        { status: 'success', target: 'right' },
      ],
    },
    {
      name: 'left',
      status: 'awaiting_user',
      data: { leftValue: { type: 'text', required: true, ...branchFieldOverrides } },
      transitions: [{ status: 'success', target: 'submit' }],
    },
    {
      name: 'right',
      status: 'awaiting_user',
      data: { rightValue: { type: 'text', required: true } },
      transitions: [{ status: 'success', target: 'submit' }],
    },
    {
      name: 'submit',
      status: 'awaiting_user',
      data: {},
      connectors: [{ name: 'k', id: 'mock_kyc_1', type: 'kyc', order: 1, ...mapping }],
      transitions: [{ status: 'success', target: 'approved' }],
    },
    { name: 'approved', status: 'approved', data: {}, transitions: [] },
  ],
});

describe('optionalFieldMapping', () => {
  it('lets a connector read a source written on only one branch', () => {
    const definition = validateAndNormalizeUntypedSteps(
      buildWorkflow({
        fieldMapping: { pick: 'pick' },
        optionalFieldMapping: { left: 'leftValue', right: 'rightValue' },
      }),
    );

    expect(definition.stepsByName.submit.connectors[0].optionalFieldMapping).toEqual({
      left: 'leftValue',
      right: 'rightValue',
    });
  });

  it('still refuses that source in the required mapping, which could only fail at runtime', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(buildWorkflow({ fieldMapping: { left: 'leftValue' } })),
    ).toThrow(WorkflowInvalidError);
  });

  it('still refuses an unpersisted source, which is absent on every path rather than some', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(
        buildWorkflow(
          { fieldMapping: { pick: 'pick' }, optionalFieldMapping: { left: 'leftValue' } },
          { persist: false },
        ),
      ),
    ).toThrow(WorkflowInvalidError);
  });

  it('refuses a payload key claimed by both mappings', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(
        buildWorkflow({
          fieldMapping: { pick: 'pick' },
          optionalFieldMapping: { pick: 'rightValue' },
        }),
      ),
    ).toThrow(WorkflowInvalidError);
  });

  it('refuses an optional source no step declares', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(
        buildWorkflow({ fieldMapping: { pick: 'pick' }, optionalFieldMapping: { x: 'nowhere' } }),
      ),
    ).toThrow(WorkflowInvalidError);
  });

  it('defaults to an empty map so every declaration has the same shape', () => {
    const definition = validateAndNormalizeUntypedSteps(
      buildWorkflow({ fieldMapping: { pick: 'pick' } }),
    );

    expect(definition.stepsByName.submit.connectors[0].optionalFieldMapping).toEqual({});
  });

  /**
   * The executor builds every chain link's payload from that link alone, so what a fallback
   * inherits decides what the stand-in provider is actually sent.
   */
  describe('on a fallback', () => {
    const fallback = (overrides: Record<string, unknown> = {}) => [
      { name: 'backup', id: 'mock_kyc_2', type: 'kyc', ...overrides },
    ];

    it('inherits the primary optional mapping when the fallback declares none', () => {
      const definition = validateAndNormalizeUntypedSteps(
        buildWorkflow({
          fieldMapping: { pick: 'pick' },
          optionalFieldMapping: { left: 'leftValue' },
          fallback: fallback(),
        }),
      );

      expect(definition.stepsByName.submit.connectors[0].fallbacks[0].optionalFieldMapping).toEqual(
        { left: 'leftValue' },
      );
    });

    it('replaces the inherited mapping rather than merging into it when it declares its own', () => {
      const definition = validateAndNormalizeUntypedSteps(
        buildWorkflow({
          fieldMapping: { pick: 'pick' },
          optionalFieldMapping: { left: 'leftValue' },
          fallback: fallback({ optionalFieldMapping: { right: 'rightValue' } }),
        }),
      );

      expect(definition.stepsByName.submit.connectors[0].fallbacks[0].optionalFieldMapping).toEqual(
        { right: 'rightValue' },
      );
    });

    it('defaults to an empty map when neither the primary nor the fallback declares one', () => {
      const definition = validateAndNormalizeUntypedSteps(
        buildWorkflow({ fieldMapping: { pick: 'pick' }, fallback: fallback() }),
      );

      expect(definition.stepsByName.submit.connectors[0].fallbacks[0].optionalFieldMapping).toEqual(
        {},
      );
    });

    it('refuses a payload key its resolved required mapping already carries', () => {
      expect(() =>
        validateAndNormalizeUntypedSteps(
          buildWorkflow({
            fieldMapping: { pick: 'pick' },
            fallback: fallback({ optionalFieldMapping: { pick: 'leftValue' } }),
          }),
        ),
      ).toThrow(WorkflowInvalidError);
    });

    it('refuses an optional source no step declares', () => {
      expect(() =>
        validateAndNormalizeUntypedSteps(
          buildWorkflow({
            fieldMapping: { pick: 'pick' },
            fallback: fallback({ optionalFieldMapping: { left: 'absentValue' } }),
          }),
        ),
      ).toThrow(WorkflowInvalidError);
    });
  });
});
