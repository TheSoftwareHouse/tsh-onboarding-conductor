import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COALESCE_MS, MAX_UNDO_STEPS, useEditHistory } from './useEditHistory';

describe('useEditHistory', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Records each text as an edit made after a pause, so each is its own step. */
  function recordApart(result: { current: ReturnType<typeof useEditHistory> }, texts: string[]) {
    for (const text of texts) {
      vi.advanceTimersByTime(COALESCE_MS + 1);
      act(() => result.current.record(text));
    }
  }

  it('steps back through edits, newest first, and forward again', () => {
    const { result } = renderHook(() => useEditHistory());
    recordApart(result, ['a', 'b']);

    let undone: string | null = null;
    act(() => {
      undone = result.current.undo('c');
    });
    expect(undone).toBe('b');

    let redone: string | null = null;
    act(() => {
      redone = result.current.redo('b');
    });
    expect(redone).toBe('c');
  });

  it('merges edits made in quick succession into one step', () => {
    const { result } = renderHook(() => useEditHistory());
    act(() => result.current.record('a'));
    act(() => result.current.record('ab'));
    act(() => result.current.record('abc'));

    let undone: string | null = null;
    act(() => {
      undone = result.current.undo('abcd');
    });
    expect(undone).toBe('a');
    expect(result.current.canUndo).toBe(false);
  });

  it('keeps only the newest steps past the limit', () => {
    const { result } = renderHook(() => useEditHistory());
    const extra = 5;
    recordApart(
      result,
      Array.from({ length: MAX_UNDO_STEPS + extra }, (_, index) => `v${index}`),
    );

    const undone: (string | null)[] = [];
    while (result.current.canUndo) {
      act(() => {
        undone.push(result.current.undo('current'));
      });
    }

    expect(undone).toHaveLength(MAX_UNDO_STEPS);
    expect(undone.at(-1)).toBe(`v${extra}`);
  });

  it('drops the redo steps once a new edit is made', () => {
    const { result } = renderHook(() => useEditHistory());
    recordApart(result, ['a']);
    act(() => {
      result.current.undo('b');
    });
    expect(result.current.canRedo).toBe(true);

    recordApart(result, ['a']);
    expect(result.current.canRedo).toBe(false);
  });
});
