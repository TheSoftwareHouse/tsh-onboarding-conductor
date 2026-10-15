import { Injectable } from '@nestjs/common';

export interface WaitOptions<T> {
  /** Reads the current value, the engine's `/state` in practice. */
  fetch: () => Promise<T>;
  /** `true` once the value is worth returning instead of waiting on. */
  isSettled: (value: T) => boolean;
  timeoutMs: number;
  pollMs: number;
}

/**
 * Holds a long-poll request until its onboarding changes. The engine's webhook is an optional
 * accelerator (it refuses a plain-HTTP non-loopback base URL), so the waiter re-reads on a
 * fixed tick and treats `wake` as a way to read sooner, never as the source of truth.
 */
@Injectable()
export class StateWaiter {
  private readonly sleepers = new Map<string, Set<() => void>>();

  /** Wakes every request waiting on `key`; a no-op when none is. */
  wake(key: string): void {
    for (const wakeUp of this.sleepers.get(key) ?? []) {
      wakeUp();
    }
  }

  async waitFor<T>(key: string, options: WaitOptions<T>): Promise<T> {
    const deadline = Date.now() + options.timeoutMs;
    let value = await options.fetch();

    while (!options.isSettled(value)) {
      const remaining = deadline - Date.now();

      if (remaining <= 0) {
        break;
      }

      await this.sleep(key, Math.min(options.pollMs, remaining));
      value = await options.fetch();
    }

    return value;
  }

  private sleep(key: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const group = this.sleepers.get(key) ?? new Set<() => void>();
      const done = () => {
        clearTimeout(timer);
        group.delete(done);
        if (group.size === 0) {
          this.sleepers.delete(key);
        }
        resolve();
      };
      const timer = setTimeout(done, ms);

      group.add(done);
      this.sleepers.set(key, group);
    });
  }
}
