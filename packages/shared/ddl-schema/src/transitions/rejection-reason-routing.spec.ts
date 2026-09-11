import { CONNECTOR_REJECTION_REASONS } from '../workflow-contract';
import { validateAndNormalizeUntypedSteps } from '../testing/untyped-steps.helper';
import { WorkflowInvalidError } from '../workflow-validator';

type TransitionFixture = Record<string, unknown>;

const buildWorkflow = (transitions: TransitionFixture[], canReject = true) => ({
  id: 'reason-routing',
  version: 1,
  name: 'Reason routing',
  initial: 'verify',
  steps: [
    {
      name: 'verify',
      status: 'awaiting_user',
      data: { code: { type: 'text', required: true } },
      connectors: [
        {
          name: 'verifier',
          id: 'twilio_verify',
          type: 'phone_verification',
          canReject,
          order: 1,
          fieldMapping: { code: 'code' },
        },
      ],
      transitions,
    },
    {
      name: 'resend',
      status: 'awaiting_user',
      data: {},
      transitions: [{ status: 'success', target: 'verify' }],
    },
    { name: 'approved', status: 'approved', data: {}, transitions: [] },
    { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
  ],
});

const SUCCESS = { status: 'success', target: 'approved' };
const REFUSAL = { status: 'rejected', target: 'rejected' };
const RECOVER = {
  status: 'rejected',
  reason: ['CHALLENGE_EXPIRED', 'CHALLENGE_NOT_FOUND'],
  target: 'resend',
};

const normalizeVerifyStep = (transitions: TransitionFixture[]) =>
  validateAndNormalizeUntypedSteps(buildWorkflow(transitions)).stepsByName.verify.transitions;

describe('rejection reason routing', () => {
  it('lets a reason-qualified rejection route to a non-terminal step', () => {
    const transitions = normalizeVerifyStep([SUCCESS, RECOVER, REFUSAL]);

    expect(transitions[1]).toMatchObject({
      status: 'rejected',
      target: 'resend',
      reason: ['CHALLENGE_EXPIRED', 'CHALLENGE_NOT_FOUND'],
    });
    expect(transitions[2].reason).toBeUndefined();
  });

  it('still demands an unqualified arm, so no refusal goes unhandled', () => {
    expect(() => validateAndNormalizeUntypedSteps(buildWorkflow([SUCCESS, RECOVER]))).toThrow(
      WorkflowInvalidError,
    );
  });

  it('still forces the unqualified arm onto a terminal rejected step', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(
        buildWorkflow([SUCCESS, RECOVER, { status: 'rejected', target: 'resend' }]),
      ),
    ).toThrow(WorkflowInvalidError);
  });

  it('rejects a reason naming a step that does not exist', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(
        buildWorkflow([SUCCESS, { ...RECOVER, target: 'nowhere' }, REFUSAL]),
      ),
    ).toThrow(WorkflowInvalidError);
  });

  it('rejects a reason on a step whose connectors cannot reject at all', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(buildWorkflow([SUCCESS, RECOVER, REFUSAL], false)),
    ).toThrow(WorkflowInvalidError);
  });

  it('rejects a reason on a non-rejected transition', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(
        buildWorkflow([{ ...SUCCESS, reason: ['CHALLENGE_EXPIRED'] }, REFUSAL]),
      ),
    ).toThrow(WorkflowInvalidError);
  });

  it.each([
    ['an unknown reason', ['NOPE']],
    ['a duplicate reason', ['CHALLENGE_EXPIRED', 'CHALLENGE_EXPIRED']],
    ['an empty list', []],
  ])('rejects %s', (_label, reason) => {
    expect(() =>
      validateAndNormalizeUntypedSteps(buildWorkflow([SUCCESS, { ...RECOVER, reason }, REFUSAL])),
    ).toThrow(WorkflowInvalidError);
  });

  it('requires the unqualified arm to come last in its status group', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(buildWorkflow([SUCCESS, REFUSAL, RECOVER])),
    ).toThrow(WorkflowInvalidError);
  });

  it('accepts every reason the vocabulary declares', () => {
    const transitions = normalizeVerifyStep([
      SUCCESS,
      { status: 'rejected', reason: [...CONNECTOR_REJECTION_REASONS], target: 'resend' },
      REFUSAL,
    ]);

    expect(transitions[1].reason).toEqual([...CONNECTOR_REJECTION_REASONS]);
  });
});
