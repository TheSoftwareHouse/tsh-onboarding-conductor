import type { components } from '@tsh/openapi';
import { FieldClassLookup } from '../../classification/field-class-lookup';
import { ANALYST_INVESTIGATION_COMPILED } from '../../classification/testing/analyst-investigation.fixture';
import { EngineClient } from '../../engine/engine-client';
import { FieldClassifier } from '../../masking/field-classifier';
import { Masker } from '../../masking/masker';
import { RequestContext } from '../../request-context/request-context';
import { GetOnboardingTimelineTool } from './get-onboarding-timeline.tool';
import { buildTimeline, TimelineEvent, TimelineEventKind } from './onboarding-timeline';

type Audit = components['schemas']['AuditEventResponseDto'];
type Transition = components['schemas']['OnboardingTransitionResponseDto'];

const CONTEXT: RequestContext = { identity: { kind: 'local' } };
const ONBOARDING_ID = '01a19540-8263-74cc-9e95-0919c01431bf';
const KEY = 'k'.repeat(32);
const AUDIT_PAGE_SIZE = 100;

const SUMMARY = {
  onboardingId: ONBOARDING_ID,
  workflowId: 'analyst-investigation',
  workflowVersion: 1,
  status: 'rejected',
  currentStep: null,
  expiresAt: null,
  createdAt: '2026-10-11T03:56:24.255Z',
  updatedAt: '2026-10-11T03:56:24.507Z',
  completedAt: '2026-10-11T03:56:24.581Z',
  rejectionReason: 'CONNECTOR_REJECTED',
  scores: { risk: 70 },
  agreementStatus: 'not_accepted',
  pendingConnector: null,
};

function audit(
  id: string,
  occurredAt: string,
  action: string,
  metadata: Record<string, unknown> = {},
): Audit {
  return {
    id,
    occurredAt,
    actorType: 'system',
    actorId: 'engine',
    action,
    resourceType: 'onboarding',
    resourceId: ONBOARDING_ID,
    metadata,
  };
}

function transition(
  id: string,
  occurredAt: string,
  overrides: Partial<Transition> = {},
): Transition {
  return {
    id,
    occurredAt,
    status: 'awaiting_user',
    fromStep: null,
    appliedStep: null,
    enteredStep: 'collect_profile',
    trigger: null,
    current: false,
    ...overrides,
  };
}

const STARTED = audit('a-1', '2026-10-11T03:56:24.316Z', 'onboarding.started', {
  toStatus: 'awaiting_user',
  toCurrentStep: 'collect_profile',
  fromScores: null,
  toScores: { risk: 0 },
});
const REJECTED = audit('a-3', '2026-10-11T03:56:24.705Z', 'onboarding.state_transition', {
  appliedStep: 'collect_profile',
  fromStatus: 'awaiting_user',
  toStatus: 'rejected',
  fromCurrentStep: 'collect_profile',
  toCurrentStep: null,
  fromScores: { risk: 0 },
  toScores: { risk: 70 },
});
const NOISE = audit('a-2', '2026-10-11T03:56:24.437Z', 'webhook.outbound_notification_suppressed', {
  reason: 'no_configured_webhook',
  payload: { email: 'leak@example.com' },
});
const STARTED_MOVE = transition('a-1', STARTED.occurredAt);
const REJECTED_MOVE = transition('a-3', REJECTED.occurredAt, {
  status: 'rejected',
  fromStep: 'collect_profile',
  appliedStep: 'collect_profile',
  enteredStep: 'rejected',
  current: true,
});

describe('buildTimeline', () => {
  const masker = new Masker(KEY);
  const mask = (...entries: Audit[]) => entries.map((entry) => masker.maskAuditEntry(entry));

  it('orders by time whatever the order of the input, newest-first as the audit API serves it', () => {
    const events = buildTimeline(mask(REJECTED, NOISE, STARTED), [STARTED_MOVE, REJECTED_MOVE]);

    expect(events.map((event) => event.id)).toEqual(['a-1', 'a-2', 'a-3']);
  });

  it('shows a move recorded in both sources once, with scores from the audit row and the trigger from the transition', () => {
    const review = audit('a-9', '2026-10-12T00:00:00.000Z', 'onboarding.manual_review_decision', {
      fromStatus: 'awaiting_manual_review',
      toStatus: 'approved',
      fromCurrentStep: 'review_identity',
      toCurrentStep: null,
      fromScores: { risk: 0 },
      toScores: { risk: 0 },
    });

    const events = buildTimeline(mask(STARTED, REJECTED, review), [
      STARTED_MOVE,
      REJECTED_MOVE,
      transition('a-9', review.occurredAt, { status: 'approved', trigger: 'manual.approve' }),
    ]);

    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({
      kind: TimelineEventKind.TRANSITION,
      current: true,
      move: {
        fromStatus: 'awaiting_user',
        toStatus: 'rejected',
        fromStep: 'collect_profile',
        toStep: null,
        fromScores: { risk: 0 },
        toScores: { risk: 70 },
        trigger: null,
      },
    });
    expect(events[2]).toMatchObject({
      kind: TimelineEventKind.REVIEW_DECISION,
      move: { trigger: 'manual.approve' },
    });
    expect(events[0].kind).toBe(TimelineEventKind.STARTED);
  });

  it('keeps a transition the audit listing did not return', () => {
    const events = buildTimeline(mask(STARTED), [STARTED_MOVE, REJECTED_MOVE]);

    expect(events.map((event) => event.id)).toEqual(['a-1', 'a-3']);
    expect(events[1]).toMatchObject({
      kind: TimelineEventKind.TRANSITION,
      current: true,
      move: { toStatus: 'rejected', toStep: 'rejected' },
    });
    expect(events[1]).not.toHaveProperty('action');
  });

  it('orders events at the same instant by id', () => {
    const second = audit('b-2', STARTED.occurredAt, 'onboarding.rejected_attempt');
    const first = audit('b-1', STARTED.occurredAt, 'onboarding.rejected_attempt');

    expect(buildTimeline(mask(second, first), []).map((event) => event.id)).toEqual(['b-1', 'b-2']);
  });

  it.each([
    ['onboarding.rejected_attempt', TimelineEventKind.REJECTED_ATTEMPT],
    ['connector.result_rejected', TimelineEventKind.CONNECTOR_OUTCOME],
    ['connector.result_invalid_data', TimelineEventKind.CONNECTOR_OUTCOME],
    ['connector.failure_retried', TimelineEventKind.CONNECTOR_FAILURE],
    ['connector.failure_propagated', TimelineEventKind.CONNECTOR_FAILURE],
    ['webhook.inbound_callback_applied', TimelineEventKind.CALLBACK_APPLIED],
    ['webhook.inbound_callback_rejected', TimelineEventKind.CALLBACK_REJECTED],
    ['onboarding.pending_connector_reconciled', TimelineEventKind.RECONCILE],
    ['onboarding.pending_connector_reconcile_noop', TimelineEventKind.RECONCILE],
    ['webhook.outbound_notification_suppressed', TimelineEventKind.OTHER],
  ])('classifies %s as %s', (action, kind) => {
    const [event] = buildTimeline(mask(audit('x', STARTED.occurredAt, action)), []);

    expect(event.kind).toBe(kind);
  });
});

describe('GetOnboardingTimelineTool', () => {
  const classes = new FieldClassifier(['country']).classify(ANALYST_INVESTIGATION_COMPILED);
  let request: jest.Mock;
  let auditPages: Audit[][];
  let transitions: Transition[];
  let tool: GetOnboardingTimelineTool;

  type TimelineResult = {
    onboarding: unknown;
    events: TimelineEvent[];
    truncated: boolean;
    warnings?: string[];
  };

  beforeEach(() => {
    auditPages = [[REJECTED, NOISE, STARTED]];
    transitions = [STARTED_MOVE, REJECTED_MOVE];
    request = jest.fn((_method: string, path: string, _context: RequestContext, args) => {
      switch (path) {
        case '/v1/onboardings/{id}':
          return Promise.resolve(SUMMARY);
        case '/v1/onboardings/{id}/transitions':
          return Promise.resolve({ items: transitions, meta: { truncated: false } });
        default:
          return Promise.resolve({
            items: auditPages[args.query.page - 1],
            meta: {
              pagination: {
                page: args.query.page,
                limit: AUDIT_PAGE_SIZE,
                total: 0,
                totalPages: auditPages.length,
              },
            },
          });
      }
    });
    const lookup = {
      getVersionClasses: jest.fn().mockResolvedValue({ classes }),
    } as unknown as FieldClassLookup;
    tool = new GetOnboardingTimelineTool(
      { request } as unknown as EngineClient,
      lookup,
      new Masker(KEY),
    );
  });

  it('merges both sources into an ordered, de-duplicated list asking the audit API for this onboarding', async () => {
    const result = (await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)) as TimelineResult;

    expect(result.events.map((event) => event.id)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(result.truncated).toBe(false);
    expect(request).toHaveBeenCalledWith('get', '/v1/admin/audit', CONTEXT, {
      query: { resourceId: ONBOARDING_ID, page: 1, limit: AUDIT_PAGE_SIZE },
    });
  });

  it('masks every audit entry: unlisted keys and applicant values never appear', async () => {
    auditPages = [
      [
        audit('a-5', '2026-10-11T03:56:24.600Z', 'webhook.inbound_callback_applied', {
          outcome: 'persisted',
          submittedData: {
            providerVerdict: 'review',
            firstName: 'Zofia',
            email: 'Zofia.K@example.com',
            occupationTitle: 'Technician',
          },
          connectorExecutionResult: {
            status: 'rejected',
            reason: 'CONNECTOR_REJECTED',
            metadata: { name: 'Zofia' },
          },
        }),
        NOISE,
        STARTED,
      ],
    ];

    const result = (await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)) as TimelineResult;
    const text = JSON.stringify(result);

    for (const secret of ['Zofia', 'Technician', 'leak@example.com', 'example.com']) {
      expect(text).not.toContain(secret);
    }
    const callback = result.events.find((event) => event.id === 'a-5');
    expect(callback?.kind).toBe(TimelineEventKind.CALLBACK_APPLIED);
    expect(callback?.detail).toMatchObject({
      outcome: 'persisted',
      submittedData: {
        providerVerdict: 'review',
        email: expect.stringMatching(/^email:[0-9a-f]{12}$/),
      },
      connectorExecutionResult: { status: 'rejected', reason: 'CONNECTOR_REJECTED' },
    });
  });

  it('carries the deciding score move of a score rejection', async () => {
    const result = (await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)) as TimelineResult;
    const deciding = result.events.find((event) => event.move?.toStatus === 'rejected');

    expect(deciding?.move).toMatchObject({
      appliedStep: 'collect_profile',
      fromScores: { risk: 0 },
      toScores: { risk: 70 },
    });
  });

  it('pages the audit API and reports truncation at the page cap', async () => {
    const cap = 20;
    auditPages = Array.from({ length: cap + 1 }, (_, index) => [
      audit(`p-${index}`, STARTED.occurredAt, 'onboarding.rejected_attempt'),
    ]);

    const result = (await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)) as TimelineResult;

    const auditCalls = request.mock.calls.filter(([, path]) => path === '/v1/admin/audit');
    expect(auditCalls).toHaveLength(cap);
    expect(result.truncated).toBe(true);
    expect(result.warnings?.[0]).toContain('earlier events are missing');
  });

  it('refuses a malformed onboarding id without calling the engine', async () => {
    await expect(tool.handler({ onboardingId: 'not-a-uuid' }, CONTEXT)).rejects.toThrow(
      'onboardingId is required',
    );
    expect(request).not.toHaveBeenCalled();
  });
});
