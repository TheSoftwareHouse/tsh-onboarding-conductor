import { useRef, useState } from 'react';

/** Versions kept to step back through. */
export const MAX_UNDO_STEPS = 100;
/** Edits closer together than this are one undo step. */
export const COALESCE_MS = 500;

interface History {
  past: string[];
  future: string[];
}

export interface EditHistory {
  canUndo: boolean;
  canRedo: boolean;
  /** Called with the text as it was, before an edit replaces it. */
  record: (before: string) => void;
  /** The text to show after stepping back from `current`, or `null` with nothing to undo. */
  undo: (current: string) => string | null;
  redo: (current: string) => string | null;
  clear: () => void;
}

/** The draft's undo stack: whole document versions, newest last, with bursts of edits merged. */
export function useEditHistory(): EditHistory {
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  // When the last edit was recorded; read in handlers only.
  const lastEditAt = useRef(0);

  function record(before: string): void {
    const now = Date.now();
    const startsStep = now - lastEditAt.current > COALESCE_MS;
    lastEditAt.current = now;
    setHistory((current) => ({
      past: startsStep ? [...current.past, before].slice(-MAX_UNDO_STEPS) : current.past,
      future: [],
    }));
  }

  function undo(current: string): string | null {
    const previous = history.past.at(-1);
    if (previous === undefined) return null;
    lastEditAt.current = 0;
    setHistory({ past: history.past.slice(0, -1), future: [current, ...history.future] });
    return previous;
  }

  function redo(current: string): string | null {
    const [next, ...rest] = history.future;
    if (next === undefined) return null;
    lastEditAt.current = 0;
    setHistory({ past: [...history.past, current].slice(-MAX_UNDO_STEPS), future: rest });
    return next;
  }

  function clear(): void {
    lastEditAt.current = 0;
    setHistory({ past: [], future: [] });
  }

  return {
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    record,
    undo,
    redo,
    clear,
  };
}
