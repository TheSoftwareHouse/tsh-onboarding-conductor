import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOnboardingTransitions,
  OnboardingTransitionsFetchError,
} from './admin-onboarding-transitions';

const { mockedGet } = vi.hoisted(() => ({ mockedGet: vi.fn() }));

vi.mock('@/shared/api/http-client', () => ({
  httpClient: { get: mockedGet },
}));

const ONBOARDING_ID = '018f1e2a-1111-7000-8000-000000000001';

const transition = (overrides: Record<string, unknown> = {}) => ({
  id: 'row-1',
  occurredAt: '2026-07-01T10:00:00.000Z',
  status: 'awaiting_manual_review',
  fromStep: 'collect-documents',
  appliedStep: 'collect-documents',
  enteredStep: 'review-documents',
  trigger: null,
  current: true,
  ...overrides,
});

const respondWith = (data: unknown) => mockedGet.mockResolvedValue({ data });

const rejectWith = (status: number) =>
  mockedGet.mockRejectedValue(
    new AxiosError('Request failed', 'ERR', undefined, undefined, {
      status,
      statusText: '',
      data: {},
      headers: {},
      config: { headers: new AxiosHeaders() },
    }),
  );

beforeEach(() => {
  mockedGet.mockReset();
});

describe('fetchOnboardingTransitions', () => {
  it('reads the transitions of the onboarding it was given', async () => {
    respondWith({ items: [], meta: { truncated: false } });

    await fetchOnboardingTransitions(ONBOARDING_ID);

    expect(mockedGet).toHaveBeenCalledWith(`/v1/onboardings/${ONBOARDING_ID}/transitions`);
  });

  it('escapes an id that would otherwise change the path it reads', async () => {
    respondWith({ items: [], meta: { truncated: false } });

    await fetchOnboardingTransitions('../audit');

    expect(mockedGet).toHaveBeenCalledWith('/v1/onboardings/..%2Faudit/transitions');
  });

  it('labels a move by the step it entered', async () => {
    respondWith({ items: [transition()], meta: { truncated: false } });

    const trail = await fetchOnboardingTransitions(ONBOARDING_ID);

    expect(trail.transitions[0].label).toBe('review-documents');
    expect(trail.transitions[0].enteredStep).toBe('review-documents');
  });

  it('labels a move that entered no step by the status it reached', async () => {
    respondWith({
      items: [transition({ enteredStep: null, status: 'approved' })],
      meta: { truncated: false },
    });

    const trail = await fetchOnboardingTransitions(ONBOARDING_ID);

    expect(trail.transitions[0].label).toBe('Approved');
  });

  it('reports a status the panel does not recognize as it arrived', async () => {
    respondWith({
      items: [transition({ enteredStep: null, status: 'quarantined' })],
      meta: { truncated: false },
    });

    const trail = await fetchOnboardingTransitions(ONBOARDING_ID);

    expect(trail.transitions[0].label).toBe('quarantined');
  });

  it('passes on that the endpoint reported only part of the trail', async () => {
    respondWith({ items: [transition()], meta: { truncated: true } });

    await expect(fetchOnboardingTransitions(ONBOARDING_ID)).resolves.toMatchObject({
      truncated: true,
    });
  });

  it('reads an id the engine holds no record of as an empty trail, not a failure', async () => {
    rejectWith(404);

    await expect(fetchOnboardingTransitions(ONBOARDING_ID)).resolves.toEqual({
      transitions: [],
      truncated: false,
    });
  });

  it('raises a refusal with a message an operator can act on', async () => {
    rejectWith(403);

    await expect(fetchOnboardingTransitions(ONBOARDING_ID)).rejects.toMatchObject({
      name: 'OnboardingTransitionsFetchError',
      reason: 'request-failed',
      status: 403,
    });
  });

  it('raises a malformed payload rather than drawing a chain from it', async () => {
    respondWith({ items: [transition({ current: 'yes' })], meta: { truncated: false } });

    await expect(fetchOnboardingTransitions(ONBOARDING_ID)).rejects.toBeInstanceOf(
      OnboardingTransitionsFetchError,
    );
  });
});

describe('fetchOnboardingTransitions score reporting', () => {
  it('carries the running total, the delta and the bypassed steps through', async () => {
    respondWith({
      items: [
        transition({
          scoreAfter: 40,
          scoreDelta: 30,
          skippedSteps: ['enhanced_due_diligence'],
        }),
      ],
      meta: { truncated: false },
    });

    const trail = await fetchOnboardingTransitions(ONBOARDING_ID);

    expect(trail.transitions[0].scoreAfter).toBe(40);
    expect(trail.transitions[0].scoreDelta).toBe(30);
    expect(trail.transitions[0].skippedSteps).toEqual(['enhanced_due_diligence']);
  });

  it('still renders a trail from an engine that reports no scoring fields', async () => {
    respondWith({ items: [transition()], meta: { truncated: false } });

    const trail = await fetchOnboardingTransitions(ONBOARDING_ID);

    expect(trail.transitions[0].scoreAfter).toBe(0);
    expect(trail.transitions[0].scoreDelta).toBe(0);
    expect(trail.transitions[0].skippedSteps).toEqual([]);
  });
});
