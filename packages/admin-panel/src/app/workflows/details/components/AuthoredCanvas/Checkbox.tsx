import type { InputHTMLAttributes, ReactElement } from 'react';

/** `components/ui` has no checkbox, so this is the one raw `<input>` in the family. */
export function Checkbox(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>): ReactElement {
  return <input type="checkbox" className="size-4 shrink-0 cursor-pointer" {...props} />;
}
