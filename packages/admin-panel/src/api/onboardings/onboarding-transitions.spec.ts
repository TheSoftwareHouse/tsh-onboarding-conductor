import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOnboardingTransitions,
  OnboardingTransitionsFetchError,
} from './onboarding-transitions';

const { mockedGet } = vi.hoisted(() => ({ mockedGet: vi.fn() }));

vi.mock('@/services/api/http-client', () => ({
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

  it('passes an unrecognized status through the parser without adding a label', async () => {
    const item = transition({ enteredStep: null, status: 'quarantined' });
    respondWith({ items: [item], meta: { truncated: false } });

    const trail = await fetchOnboardingTransitions(ONBOARDING_ID);

    expect(trail.transitions[0]).toEqual({
      id: item.id,
      occurredAt: item.occurredAt,
      status: item.status,
      fromStep: item.fromStep,
      appliedStep: item.appliedStep,
      enteredStep: item.enteredStep,
      trigger: item.trigger,
      current: item.current,
    });
  });
});
