import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

const TOKEN_BYTES = 16;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 24;
/** The engine's delivery window is about 75 s; a day is headroom. */
export const EVENT_RETENTION_MS = HOURS_PER_DAY * SECONDS_PER_HOUR * MILLISECONDS_PER_SECOND;

export interface BnplSession {
  onboardingId: string;
  persona: string;
  createdAt: Date;
  lastEventId?: string;
}

/**
 * In-memory binding of an unguessable token to an onboarding. The onboarding id never leaves the
 * BFF, and the client never chooses one. A restart forgets every session, which the demo
 * accepts.
 */
@Injectable()
export class BnplSessionStore {
  private readonly sessions = new Map<string, BnplSession>();
  private readonly tokenByOnboarding = new Map<string, string>();
  private readonly claimedEvents = new Map<string, number>();

  create(onboardingId: string, persona: string): string {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    this.sessions.set(token, { onboardingId, persona, createdAt: new Date() });
    this.tokenByOnboarding.set(onboardingId, token);

    return token;
  }

  get(token: string): BnplSession | undefined {
    return this.sessions.get(token);
  }

  findByOnboardingId(onboardingId: string): BnplSession | undefined {
    const token = this.tokenByOnboarding.get(onboardingId);

    return token === undefined ? undefined : this.sessions.get(token);
  }

  /** Takes the claim on a webhook event id; `false` when it was already taken (a redelivery). */
  claimEvent(eventId: string, now = Date.now()): boolean {
    for (const [id, claimedAt] of this.claimedEvents) {
      if (now - claimedAt < EVENT_RETENTION_MS) {
        break;
      }
      this.claimedEvents.delete(id);
    }

    if (this.claimedEvents.has(eventId)) {
      return false;
    }

    this.claimedEvents.set(eventId, now);

    return true;
  }
}
