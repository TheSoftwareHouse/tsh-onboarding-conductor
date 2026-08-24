import { describe, expect, it } from 'vitest';
import type { OnboardingTransition } from './onboarding-transitions';
import { buildTrailGraph } from './trail-graph';

function transition(overrides: Partial<OnboardingTransition>): OnboardingTransition {
  return {
    id: 'event',
    occurredAt: '2026-07-01T10:00:00.000Z',
    label: 'collect_email',
    status: 'awaiting_user',
    fromStep: null,
    appliedStep: null,
    enteredStep: 'collect_email',
    trigger: null,
    current: false,
    ...overrides,
  };
}

/** An onboarding that collected an email, went to review, and was approved by an operator. */
const TRAIL: OnboardingTransition[] = [
  transition({ id: 'e1' }),
  transition({
    id: 'e2',
    occurredAt: '2026-07-01T11:00:00.000Z',
    label: 'review',
    status: 'awaiting_manual_review',
    fromStep: 'collect_email',
    appliedStep: 'collect_email',
    enteredStep: 'review',
  }),
  transition({
    id: 'e3',
    occurredAt: '2026-07-01T12:00:00.000Z',
    label: 'approved',
    status: 'approved',
    fromStep: 'review',
    appliedStep: 'review',
    enteredStep: 'approved',
    trigger: 'manual.approve',
    current: true,
  }),
];

describe('buildTrailGraph', () => {
  const graph = buildTrailGraph(TRAIL);
  const nodeNamed = (name: string) => graph.nodes.find((node) => node.id === name)!;

  it('draws one node per state entered, in the order they were entered', () => {
    expect(graph.nodes.map((node) => node.id)).toEqual(['collect_email', 'review', 'approved']);
  });

  it('joins each state to the one entered after it', () => {
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['collect_email', 'review'],
      ['review', 'approved'],
    ]);
  });

  it('colours the states the same way a declared workflow does', () => {
    // Same vocabulary as layoutWorkflowGraph, which is the point: one kind of drawing either way.
    expect(nodeNamed('collect_email').data.state).toBe('completed');
    expect(nodeNamed('review').data.state).toBe('completed');
    expect(nodeNamed('approved').data.state).toBe('completed');
  });

  it('marks the state an in-flight onboarding is waiting on as the current one', () => {
    const inFlight = buildTrailGraph(TRAIL.slice(0, 2));

    expect(inFlight.nodes.find((node) => node.id === 'review')!.data.state).toBe('current');
    expect(inFlight.nodes.find((node) => node.id === 'collect_email')!.data.state).toBe(
      'completed',
    );
  });

  it('marks a rejected ending as failed rather than as somewhere it is waiting', () => {
    const rejected = buildTrailGraph([
      ...TRAIL.slice(0, 2),
      transition({
        id: 'e3',
        label: 'rejected',
        status: 'rejected',
        enteredStep: 'rejected',
        trigger: 'manual.reject',
        current: true,
      }),
    ]);

    expect(rejected.nodes.find((node) => node.id === 'rejected')!.data.state).toBe('failed');
    expect(rejected.nodes.find((node) => node.id === 'review')!.data.state).toBe('completed');
  });

  it('carries the instant each state was entered', () => {
    expect(nodeNamed('review').data.enteredAt).toBe('2026-07-01T11:00:00.000Z');
  });

  it('names a state the engine could not resolve by its recorded label', () => {
    // The definition being unreadable is exactly why this graph is drawn, so the engine often
    // cannot name the step either - dropping those moves would leave the drawing blank.
    const unresolved = buildTrailGraph([
      transition({ id: 'e1', label: 'collect_email', enteredStep: null }),
      transition({
        id: 'e2',
        label: 'approved',
        status: 'approved',
        enteredStep: null,
        current: true,
      }),
    ]);

    expect(unresolved.nodes.map((node) => node.id)).toEqual(['collect_email', 'approved']);
    expect(unresolved.nodes[0]!.data.state).toBe('completed');
    expect(unresolved.nodes[1]!.data.state).toBe('completed');
  });

  it('draws a state entered twice once, keeping when it was first reached', () => {
    const looped = buildTrailGraph([
      ...TRAIL.slice(0, 2),
      transition({
        id: 'e3',
        occurredAt: '2026-07-01T13:00:00.000Z',
        label: 'collect_email',
        enteredStep: 'collect_email',
        current: true,
      }),
    ]);

    expect(looped.nodes.map((node) => node.id)).toEqual(['collect_email', 'review']);
    expect(looped.nodes[0]!.data.enteredAt).toBe('2026-07-01T10:00:00.000Z');
    // Standing back on the step it looped to, rather than reading as left behind.
    expect(looped.nodes[0]!.data.state).toBe('current');
  });

  it('draws a move it made more than once as one arrow', () => {
    const repeated = buildTrailGraph([
      ...TRAIL.slice(0, 2),
      transition({ id: 'e3', occurredAt: '2026-07-01T13:00:00.000Z' }),
      transition({
        id: 'e4',
        occurredAt: '2026-07-01T14:00:00.000Z',
        label: 'review',
        status: 'awaiting_manual_review',
        enteredStep: 'review',
        current: true,
      }),
    ]);

    expect(
      repeated.edges.filter((edge) => edge.source === 'collect_email' && edge.target === 'review'),
    ).toHaveLength(1);
  });

  it('keeps a retry onto the same state as a label rather than an arrow to nowhere', () => {
    const retried = buildTrailGraph([
      transition({ id: 'e1' }),
      transition({
        id: 'e2',
        occurredAt: '2026-07-01T11:00:00.000Z',
        trigger: 'manual.retry',
        current: true,
      }),
    ]);

    expect(retried.nodes).toHaveLength(1);
    expect(retried.nodes[0]!.data.selfTransitions).toEqual(['manual.retry']);
    expect(retried.edges).toEqual([]);
  });

  it('reports the state it stands on as the last one entered, not the last it was told about', () => {
    expect(nodeNamed('approved').data.status).toBe('approved');
  });

  it('draws nothing for an onboarding with no recorded transitions', () => {
    const empty = buildTrailGraph([]);

    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
  });
});
