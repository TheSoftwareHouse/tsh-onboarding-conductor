import { describe, expect, it } from 'vitest';
import type {
  WorkflowDefinition,
  WorkflowStepDefinition,
} from '@/api/workflows/workflow-definitions';
import type { EdgePoint } from './workflow-edge-path';
import { layoutWorkflowGraph, nodeHeight, NODE_WIDTH } from './workflow-graph-layout';

/** `[status, target]`, or `[status, target, field, value]` for an arm guarded by `field = value`. */
type Arm = [string, string] | [string, string, string, string];

interface StepSpec {
  name: string;
  arms?: Arm[];
  terminal?: boolean;
  /** The authored step and type it compiled from, when it compiled to several steps. */
  group?: [string, string];
}

function definitionOf(workflowId: string, specs: StepSpec[]): WorkflowDefinition {
  const steps = specs.map(
    ({ name, arms = [], terminal = false, group }): WorkflowStepDefinition => ({
      name,
      status: terminal ? name : 'awaiting_user',
      terminal,
      transitions: arms.map(([status, target, field, value]) => ({
        status,
        target,
        ...(field === undefined ? {} : { when: { field, equals: value } }),
        reason: null,
      })),
      source: group === undefined ? null : { step: group[0], type: group[1], category: 'verify' },
      fields: [],
      connectors: [],
    }),
  );
  return {
    workflowId,
    workflowVersion: 1,
    name: null,
    initialStep: specs[0]!.name,
    scores: {},
    webhook: null,
    steps,
  };
}

const OTP: [string, string] = ['otp', 'otp-verify'];
const DOCUMENT: [string, string] = ['document', 'document-capture'];

/** The shape of `eu-b2c-individual-kyc-eea-v2`: an OTP group, a document branch, a provider hub. */
const KYC = definitionOf('kyc-eea-v2', [
  { name: 'collect_contact', arms: [['success', 'send_phone_code']] },
  {
    name: 'send_phone_code',
    group: OTP,
    arms: [
      ['success', 'verify_phone_code'],
      ['rejected', 'rejected'],
    ],
  },
  {
    name: 'verify_phone_code',
    group: OTP,
    arms: [
      ['success', 'collect_personal'],
      ['rejected', 'resend_phone_code', 'reason', 'CHALLENGE_EXPIRED'],
      ['failed', 'rejected'],
    ],
  },
  {
    name: 'resend_phone_code',
    group: OTP,
    arms: [
      ['success', 'verify_phone_code'],
      ['rejected', 'rejected'],
    ],
  },
  { name: 'collect_personal', arms: [['success', 'collect_purpose']] },
  { name: 'collect_purpose', arms: [['success', 'select_document_type']] },
  {
    name: 'select_document_type',
    arms: [
      ['success', 'capture_id_card_front', 'documentType', 'ID_CARD'],
      ['success', 'capture_passport', 'documentType', 'PASSPORT'],
    ],
  },
  { name: 'capture_id_card_front', group: DOCUMENT, arms: [['success', 'capture_id_card_back']] },
  { name: 'capture_id_card_back', group: DOCUMENT, arms: [['success', 'capture_selfie']] },
  { name: 'capture_passport', arms: [['success', 'capture_selfie']] },
  { name: 'capture_selfie', arms: [['success', 'submit_kyc']] },
  {
    name: 'submit_kyc',
    arms: [
      ['success', 'rejected'],
      ['success', 'manual_review', 'kycOutcome', 'human_review'],
      ['success', 'capture_selfie', 'kycOutcome', 'retry_selfie'],
      ['success', 'select_document_type', 'kycOutcome', 'retry_document'],
      ['success', 'collect_purpose', 'kycOutcome', 'retry_purpose'],
      ['success', 'provision_account', 'kycOutcome', 'verified'],
    ],
  },
  {
    name: 'manual_review',
    arms: [
      ['manual.reject', 'rejected'],
      ['manual.invalid', 'invalid'],
      ['manual.approve', 'provision_account'],
    ],
  },
  { name: 'provision_account', arms: [['success', 'await_account']] },
  { name: 'await_account', arms: [['success', 'approved']] },
  { name: 'rejected', terminal: true },
  { name: 'invalid', terminal: true },
  { name: 'approved', terminal: true },
]);

/** Three providers in a fallback chain, each able to reject into one review hub that loops back. */
const MULTI_PROVIDER = definitionOf('multi-provider', [
  { name: 'collect', arms: [['success', 'check_address']] },
  {
    name: 'check_address',
    arms: [
      ['success', 'provider_a'],
      ['rejected', 'manual_review'],
    ],
  },
  {
    name: 'provider_a',
    arms: [
      ['success', 'score'],
      ['error', 'provider_b'],
      ['rejected', 'manual_review'],
      ['retry', 'collect'],
    ],
  },
  {
    name: 'provider_b',
    arms: [
      ['success', 'score'],
      ['error', 'provider_c'],
      ['rejected', 'manual_review'],
    ],
  },
  {
    name: 'provider_c',
    arms: [
      ['success', 'score'],
      ['error', 'manual_review'],
      ['rejected', 'rejected'],
    ],
  },
  {
    name: 'score',
    arms: [
      ['success', 'manual_review', 'risk', 'high'],
      ['success', 'enhanced_due_diligence', 'risk', 'medium'],
      ['success', 'approved'],
    ],
  },
  {
    name: 'enhanced_due_diligence',
    arms: [
      ['success', 'approved'],
      ['rejected', 'manual_review'],
      ['retry', 'check_address'],
    ],
  },
  {
    name: 'manual_review',
    arms: [
      ['manual.approve', 'approved'],
      ['manual.reject', 'rejected'],
      ['manual.request_info', 'collect'],
      ['manual.escalate', 'senior_review'],
    ],
  },
  {
    name: 'senior_review',
    arms: [
      ['manual.approve', 'approved'],
      ['manual.reject', 'rejected'],
      ['manual.request_info', 'check_address'],
    ],
  },
  { name: 'approved', terminal: true },
  { name: 'rejected', terminal: true },
]);

/** Screening checks that each escalate to one compliance hub, which sends work back up the flow. */
const BUSINESS = definitionOf('business', [
  { name: 'company_details', arms: [['success', 'ubo_details']] },
  {
    name: 'ubo_details',
    arms: [
      ['success', 'sanctions'],
      ['success', 'ubo_details', 'addAnother', 'yes'],
    ],
  },
  {
    name: 'sanctions',
    arms: [
      ['success', 'compliance_review', 'hit', 'yes'],
      ['success', 'pep'],
    ],
  },
  {
    name: 'pep',
    arms: [
      ['success', 'compliance_review', 'hit', 'yes'],
      ['success', 'adverse_media'],
    ],
  },
  {
    name: 'adverse_media',
    arms: [
      ['success', 'compliance_review', 'hit', 'yes'],
      ['success', 'documents'],
    ],
  },
  { name: 'documents', arms: [['success', 'verify_documents']] },
  {
    name: 'verify_documents',
    arms: [
      ['success', 'risk_score'],
      ['rejected', 'documents'],
      ['error', 'compliance_review'],
    ],
  },
  {
    name: 'risk_score',
    arms: [
      ['success', 'approved', 'risk', 'low'],
      ['success', 'compliance_review', 'risk', 'medium'],
      ['success', 'senior_review', 'risk', 'high'],
    ],
  },
  {
    name: 'compliance_review',
    arms: [
      ['manual.approve', 'approved'],
      ['manual.reject', 'rejected'],
      ['manual.request_documents', 'documents'],
      ['manual.request_ubo', 'ubo_details'],
      ['manual.escalate', 'senior_review'],
    ],
  },
  {
    name: 'senior_review',
    arms: [
      ['manual.approve', 'approved'],
      ['manual.reject', 'rejected'],
      ['manual.request_documents', 'documents'],
    ],
  },
  { name: 'approved', terminal: true },
  { name: 'rejected', terminal: true },
]);

/** Five guarded branches that cross over into three shared steps before one final check. */
const DECISION_TREE = definitionOf('decision-tree', [
  {
    name: 'start',
    arms: [
      ['success', 'branch_a', 'segment', 'a'],
      ['success', 'branch_b', 'segment', 'b'],
      ['success', 'branch_c', 'segment', 'c'],
      ['success', 'branch_d', 'segment', 'd'],
      ['success', 'branch_e', 'segment', 'e'],
    ],
  },
  {
    name: 'branch_a',
    arms: [
      ['success', 'merge_z'],
      ['rejected', 'declined'],
    ],
  },
  {
    name: 'branch_b',
    arms: [
      ['success', 'merge_y'],
      ['rejected', 'declined'],
    ],
  },
  {
    name: 'branch_c',
    arms: [
      ['success', 'merge_x'],
      ['success', 'merge_z', 'fast', 'yes'],
    ],
  },
  {
    name: 'branch_d',
    arms: [
      ['success', 'merge_x'],
      ['rejected', 'declined'],
    ],
  },
  {
    name: 'branch_e',
    arms: [
      ['success', 'merge_y'],
      ['success', 'merge_x', 'fast', 'yes'],
    ],
  },
  { name: 'merge_x', arms: [['success', 'final_check']] },
  {
    name: 'merge_y',
    arms: [
      ['success', 'final_check'],
      ['retry', 'start'],
    ],
  },
  { name: 'merge_z', arms: [['success', 'final_check']] },
  {
    name: 'final_check',
    arms: [
      ['success', 'approved'],
      ['rejected', 'declined'],
      ['retry', 'branch_c'],
    ],
  },
  { name: 'approved', terminal: true },
  { name: 'declined', terminal: true },
]);

/** A small deterministic generator, so a random workflow fails the same way every run. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const TERMINALS = ['approved', 'rejected', 'expired'];
const STATUSES = ['success', 'rejected', 'error', 'manual.approve', 'manual.reject'];

/** 14 to 22 steps, each with one to four exits forward, a quarter of them also looping back. */
function randomDefinition(seed: number): WorkflowDefinition {
  const random = createRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const count = 14 + Math.floor(random() * 9);
  const names = Array.from({ length: count }, (_, index) => `step_${index}`);
  const specs: StepSpec[] = names.map((name, index) => {
    const arms: Arm[] = [];
    const exits = 1 + Math.floor(random() * 4);
    for (let exit = 0; exit < exits; exit += 1) {
      const ahead = names.slice(index + 1, index + 6);
      const target = ahead.length === 0 || random() < 0.2 ? pick(TERMINALS) : pick(ahead);
      arms.push(
        exit === 0 ? ['success', target] : [pick(STATUSES), target, 'outcome', `value_${exit}`],
      );
    }
    if (index > 1 && random() < 0.25) {
      arms.push(['retry', names[Math.floor(random() * (index - 1))]!]);
    }
    return { name, arms };
  });
  return definitionOf(`random-${seed}`, [
    ...specs,
    ...TERMINALS.map((name) => ({ name, terminal: true })),
  ]);
}

interface Segment {
  edge: string;
  from: EdgePoint;
  to: EdgePoint;
}

const TOLERANCE = 0.5;

/** Which side of the line through `a` and `b` the point `c` lies on: positive, negative or 0. */
const orient = (a: EdgePoint, b: EdgePoint, c: EdgePoint): number => {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(value) < TOLERANCE ? 0 : Math.sign(value);
};

/** Two segments cross at a point inside both: a touch at an end does not count. */
const isCrossing = (a: Segment, b: Segment): boolean =>
  orient(a.from, a.to, b.from) * orient(a.from, a.to, b.to) < 0 &&
  orient(b.from, b.to, a.from) * orient(b.from, b.to, a.to) < 0;

/** Two segments on one line sharing more than a point: one edge drawn on top of another. */
function isOverlap(a: Segment, b: Segment): boolean {
  if (orient(a.from, a.to, b.from) !== 0 || orient(a.from, a.to, b.to) !== 0) return false;
  const horizontal = Math.abs(a.from.y - a.to.y) < TOLERANCE;
  const along = (point: EdgePoint): number => (horizontal ? point.x : point.y);
  const low = Math.max(Math.min(along(a.from), along(a.to)), Math.min(along(b.from), along(b.to)));
  const high = Math.min(Math.max(along(a.from), along(a.to)), Math.max(along(b.from), along(b.to)));
  return high - low > 1;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Whether a segment passes through a box's inside, not just along its border. */
function cutsBox({ from, to }: Segment, box: Box): boolean {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2);
  for (let step = 0; step <= steps; step += 1) {
    const share = steps === 0 ? 0 : step / steps;
    const x = from.x + (to.x - from.x) * share;
    const y = from.y + (to.y - from.y) * share;
    if (x > box.left && x < box.right && y > box.top && y < box.bottom) return true;
  }
  return false;
}

interface Measure {
  crossings: number;
  overlaps: number;
  throughSteps: number;
}

function measure(definition: WorkflowDefinition): Measure {
  const { nodes, edges } = layoutWorkflowGraph(definition);
  const segments: Segment[] = edges.flatMap((edge) => {
    const points = edge.data?.points ?? [];
    return points
      .slice(1)
      .map((to, index) => ({ edge: edge.id, from: points[index]!, to }))
      .filter(({ from, to }) => from.x !== to.x || from.y !== to.y);
  });

  let crossings = 0;
  let overlaps = 0;
  segments.forEach((segment, index) => {
    for (const other of segments.slice(index + 1)) {
      if (other.edge === segment.edge) continue;
      if (isCrossing(segment, other)) crossings += 1;
      else if (isOverlap(segment, other)) overlaps += 1;
    }
  });

  // An edge may touch its own two steps only where it leaves and enters them.
  const throughSteps = edges.filter((edge) => {
    const own = segments.filter((segment) => segment.edge === edge.id);
    return own.some((segment, index) =>
      nodes
        .filter(
          (node) =>
            (node.id !== edge.source || index > 0) &&
            (node.id !== edge.target || index < own.length - 1),
        )
        .some((node) =>
          cutsBox(segment, {
            left: node.position.x + 1,
            right: node.position.x + NODE_WIDTH - 1,
            top: node.position.y + 1,
            bottom: node.position.y + nodeHeight(node.data) - 1,
          }),
        ),
    );
  }).length;

  return { crossings, overlaps, throughSteps };
}

/**
 * Each fixture with the most crossings it may draw: today's count, so a change that adds crossings
 * fails here and one that removes them can lower the budget.
 */
const FIXTURES: Array<[string, WorkflowDefinition, number]> = [
  ['kyc-eea-v2', KYC, 6],
  ['multi-provider', MULTI_PROVIDER, 29],
  ['business', BUSINESS, 21],
  ['decision-tree', DECISION_TREE, 23],
  ...([44, 48, 37, 81, 68, 36, 22, 34, 45, 41, 28, 34, 54, 42, 43] as const).map(
    (budget, index): [string, WorkflowDefinition, number] => [
      `random-${index + 1}`,
      randomDefinition(index + 1),
      budget,
    ],
  ),
];

describe('layoutWorkflowGraph crossings', () => {
  const results = FIXTURES.map(([name, definition, budget]) => ({
    name,
    budget,
    ...measure(definition),
  }));

  it.each(results)('$name crosses no more than $budget times', ({ crossings, budget }) => {
    expect(crossings).toBeLessThanOrEqual(budget);
  });

  it.each(results)('$name runs no edge through a step', ({ throughSteps }) => {
    expect(throughSteps).toBe(0);
  });

  it.each(results)('$name draws no edge on top of another', ({ overlaps }) => {
    expect(overlaps).toBe(0);
  });
});
