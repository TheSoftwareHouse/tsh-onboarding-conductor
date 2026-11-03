import { Injectable } from '@nestjs/common';
import { CallerIdentity, getIdentityId } from '../request-context/request-context';
import { MILLISECONDS_PER_MINUTE } from '../time.constants';
import { ToolError } from '../tools/tool-error';

export const TOOL_CALLS_PER_MINUTE = 60;
export const CONCURRENT_CSV_EXPORTS_PER_IDENTITY = 1;

export class ToolRateLimitError extends ToolError {}

/** Per-identity ceilings on tool calls per minute and on simultaneous CSV exports. */
@Injectable()
export class ToolLimits {
  private readonly callTimes = new Map<string, number[]>();
  private readonly exportsRunning = new Map<string, number>();

  /** Counts one tool call against the caller's minute, or throws once the minute is used up. */
  consumeToolCall(identity: CallerIdentity): void {
    const id = getIdentityId(identity);
    const now = Date.now();
    this.forgetIdleIdentities(now);
    const recent = this.callTimes.get(id) ?? [];

    if (recent.length >= TOOL_CALLS_PER_MINUTE) {
      throw new ToolRateLimitError(
        `Rate limit reached: at most ${TOOL_CALLS_PER_MINUTE} tool calls per minute. Wait a moment and retry.`,
      );
    }

    this.callTimes.set(id, [...recent, now]);
  }

  /** Drops every call older than a minute, and an identity left with none, so the map stays small. */
  private forgetIdleIdentities(now: number): void {
    for (const [id, times] of this.callTimes) {
      const recent = times.filter((time) => now - time < MILLISECONDS_PER_MINUTE);

      if (recent.length === 0) {
        this.callTimes.delete(id);
      } else {
        this.callTimes.set(id, recent);
      }
    }
  }

  /**
   * Claims the caller's CSV export slot, or throws while one is still running. Every successful
   * acquire is paired with a `releaseCsvExport` in a `finally`.
   */
  acquireCsvExport(identity: CallerIdentity): void {
    const id = getIdentityId(identity);
    const running = this.exportsRunning.get(id) ?? 0;

    if (running >= CONCURRENT_CSV_EXPORTS_PER_IDENTITY) {
      throw new ToolRateLimitError(
        'A CSV export for this account is already running. Wait for it to finish, then retry.',
      );
    }

    this.exportsRunning.set(id, running + 1);
  }

  releaseCsvExport(identity: CallerIdentity): void {
    const id = getIdentityId(identity);
    const running = (this.exportsRunning.get(id) ?? 0) - 1;

    if (running > 0) {
      this.exportsRunning.set(id, running);
    } else {
      this.exportsRunning.delete(id);
    }
  }
}
