import type {
  OnboardingJourneyStateDescriptor,
  OnboardingProblemDocument,
  OnboardingSafeHistoryItem,
} from '@tsh/shared';

const DEFAULT_BFF_BASE_URL = 'http://localhost:3001';

export class OnboardingRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OnboardingRequestError';
    this.status = status;
  }
}

export type SubmitOutcome =
  | { ok: true; state: OnboardingJourneyStateDescriptor }
  | { ok: false; problem: OnboardingProblemDocument };

function getBffBaseUrl(): string {
  const configured = import.meta.env.VITE_BFF_BASE_URL;
  return typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : DEFAULT_BFF_BASE_URL;
}

function isProblemDocument(value: unknown): value is OnboardingProblemDocument {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<OnboardingProblemDocument>;
  return Boolean(
    candidate.type &&
    candidate.title &&
    candidate.status === 400 &&
    candidate.code === 'INVALID_STEP_DATA',
  );
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (
    !contentType.includes('application/json') &&
    !contentType.includes('application/problem+json')
  ) {
    return undefined;
  }

  return response.json();
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${getBffBaseUrl()}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new OnboardingRequestError('Unable to reach the demo BFF.', 0);
  }

  if (!response.ok) {
    throw new OnboardingRequestError(
      `Request to ${path} failed with status ${response.status}.`,
      response.status,
    );
  }

  return (await parseJsonBody(response)) as T;
}

export async function startOnboarding(): Promise<{ onboardingId: string }> {
  return requestJson<{ onboardingId: string }>('/v1/onboardings', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getOnboardingState(
  onboardingId: string,
): Promise<OnboardingJourneyStateDescriptor> {
  return requestJson<OnboardingJourneyStateDescriptor>(
    `/v1/onboardings/${encodeURIComponent(onboardingId)}/state`,
  );
}

export async function getOnboardingHistory(
  onboardingId: string,
): Promise<OnboardingSafeHistoryItem[]> {
  const items = await requestJson<OnboardingSafeHistoryItem[]>(
    `/v1/onboardings/${encodeURIComponent(onboardingId)}/history`,
  );
  return items ?? [];
}

export async function submitOnboarding(
  onboardingId: string,
  payload: Record<string, unknown>,
): Promise<SubmitOutcome> {
  let response: Response;

  try {
    response = await fetch(
      `${getBffBaseUrl()}/v1/onboardings/${encodeURIComponent(onboardingId)}/submit`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
  } catch {
    throw new OnboardingRequestError('Unable to reach the demo BFF.', 0);
  }

  const body = await parseJsonBody(response);

  if (response.status === 400 && isProblemDocument(body)) {
    return { ok: false, problem: body };
  }

  if (!response.ok) {
    throw new OnboardingRequestError(
      `Submit failed with status ${response.status}.`,
      response.status,
    );
  }

  return { ok: true, state: body as OnboardingJourneyStateDescriptor };
}
