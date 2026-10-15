const STORAGE_KEY = 'bnpl-demo-sessions';
const MAX_ENTRIES = 20;

export interface StoredSession {
  token: string;
  persona: string | null;
  startedAt: string;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;

  return (
    typeof entry.token === 'string' &&
    (typeof entry.persona === 'string' || entry.persona === null) &&
    typeof entry.startedAt === 'string'
  );
}

/** Sessions started in this browser, newest first; empty whenever storage is unavailable. */
export function readSessions(): StoredSession[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.filter(isStoredSession) : [];
  } catch {
    return [];
  }
}

export function rememberSession(token: string, persona: string | null): void {
  try {
    const next = [
      { token, persona, startedAt: new Date().toISOString() },
      ...readSessions().filter((entry) => entry.token !== token),
    ].slice(0, MAX_ENTRIES);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is a convenience; the journey works without it.
  }
}
