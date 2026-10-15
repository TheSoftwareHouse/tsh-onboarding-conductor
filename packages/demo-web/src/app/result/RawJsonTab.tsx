import type { JsonValue } from '@/api/bnpl/bnpl.client';

import { NotComputed } from './NotComputed';

const OPEN_DEPTH = 2;

function Leaf({ value }: { value: JsonValue }) {
  if (typeof value === 'string') {
    return <span className="text-card-foreground">&quot;{value}&quot;</span>;
  }
  return <span className="text-muted-foreground">{String(value)}</span>;
}

function Node({ name, value, depth }: { name: string; value: JsonValue; depth: number }) {
  if (typeof value !== 'object' || value === null) {
    return (
      <div className="py-0.5">
        <span className="text-muted-foreground">{name}: </span>
        <Leaf value={value} />
      </div>
    );
  }
  const entries: Array<[string, JsonValue]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <details open={depth < OPEN_DEPTH} className="py-0.5">
      <summary className="cursor-pointer select-none">
        <span className="text-card-foreground">{name}</span>{' '}
        <span className="text-muted-foreground">{summary}</span>
      </summary>
      <div className="ml-4 border-l border-border pl-3">
        {entries.map(([key, child]) => (
          <Node key={key} name={key} value={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

/** Collapsible tree of the analysis; nodes deeper than two levels start collapsed. */
export function RawJsonTab({ data }: { data: Record<string, JsonValue> }) {
  if (Object.keys(data).length === 0) {
    return <NotComputed what="analysis" />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card p-4 font-mono text-xs">
      <Node name="data" value={data} depth={0} />
    </div>
  );
}
