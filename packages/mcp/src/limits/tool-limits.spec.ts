import { CallerIdentity, getIdentityId } from '../request-context/request-context';
import { MILLISECONDS_PER_MINUTE } from '../time.constants';
import {
  CONCURRENT_CSV_EXPORTS_PER_IDENTITY,
  TOOL_CALLS_PER_MINUTE,
  ToolLimits,
  ToolRateLimitError,
} from './tool-limits';

const LOCAL: CallerIdentity = { kind: 'local' };
const ANALYST_A: CallerIdentity = { kind: 'user', objectId: 'oid-a', upn: 'a@example.com' };
const ANALYST_B: CallerIdentity = { kind: 'user', objectId: 'oid-b', upn: 'b@example.com' };

describe('ToolLimits', () => {
  let limits: ToolLimits;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    limits = new ToolLimits();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('tool calls per minute', () => {
    it('allows the ceiling and refuses the next call', () => {
      for (let call = 0; call < TOOL_CALLS_PER_MINUTE; call++) {
        limits.consumeToolCall(ANALYST_A);
      }

      expect(() => limits.consumeToolCall(ANALYST_A)).toThrow(ToolRateLimitError);
    });

    it('counts each identity separately', () => {
      for (let call = 0; call < TOOL_CALLS_PER_MINUTE; call++) {
        limits.consumeToolCall(ANALYST_A);
      }

      expect(() => limits.consumeToolCall(ANALYST_B)).not.toThrow();
      expect(() => limits.consumeToolCall(LOCAL)).not.toThrow();
    });

    it('frees the calls once their minute has passed', () => {
      for (let call = 0; call < TOOL_CALLS_PER_MINUTE; call++) {
        limits.consumeToolCall(ANALYST_A);
      }

      jest.advanceTimersByTime(MILLISECONDS_PER_MINUTE);

      expect(() => limits.consumeToolCall(ANALYST_A)).not.toThrow();
    });
  });

  describe('idle identities', () => {
    it('forgets an identity whose calls have all left the minute', () => {
      limits.consumeToolCall(ANALYST_A);
      limits.consumeToolCall(ANALYST_B);

      jest.advanceTimersByTime(MILLISECONDS_PER_MINUTE);
      limits.consumeToolCall(LOCAL);

      expect([...Reflect.get(limits, 'callTimes').keys()]).toEqual([getIdentityId(LOCAL)]);
    });

    it('keeps an identity that still has a call inside the minute', () => {
      limits.consumeToolCall(ANALYST_A);
      jest.advanceTimersByTime(MILLISECONDS_PER_MINUTE - 1);
      limits.consumeToolCall(ANALYST_B);

      expect(Reflect.get(limits, 'callTimes').size).toBe(2);
    });
  });

  describe('concurrent CSV exports', () => {
    it('refuses a second export while one is held and allows it after release', () => {
      for (let held = 0; held < CONCURRENT_CSV_EXPORTS_PER_IDENTITY; held++) {
        limits.acquireCsvExport(ANALYST_A);
      }

      expect(() => limits.acquireCsvExport(ANALYST_A)).toThrow(ToolRateLimitError);

      limits.releaseCsvExport(ANALYST_A);

      expect(() => limits.acquireCsvExport(ANALYST_A)).not.toThrow();
    });

    it('lets another identity export meanwhile', () => {
      limits.acquireCsvExport(ANALYST_A);

      expect(() => limits.acquireCsvExport(ANALYST_B)).not.toThrow();
    });

    it('ignores a release that has nothing to release', () => {
      limits.releaseCsvExport(ANALYST_A);

      expect(() => limits.acquireCsvExport(ANALYST_A)).not.toThrow();
    });
  });
});
