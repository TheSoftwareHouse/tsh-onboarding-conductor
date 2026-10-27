import type { ReactElement } from 'react';
import { Select } from '@/components/ui/Select/Select';
import { UNWIRED } from '../../../utils/authored-document';

export interface TargetSelectProps {
  /** The step a port or arm points at; `null` or `UNWIRED` shows the empty option. */
  value: string | null;
  stepNames: string[];
  readOnly: boolean;
  /** The first option, which clears the target. */
  emptyLabel: string;
  'aria-label': string;
  /** The chosen step, or `null` when the empty option is chosen. */
  onChange: (target: string | null) => void;
}

/** Cannot collide with a step name, which the schema restricts to letters, digits, `_` and `-`. */
const EMPTY_VALUE = '\u0000empty';

/** The keyboard path for wiring: pick a step, or the empty option to unwire. */
export function TargetSelect({
  value,
  stepNames,
  readOnly,
  emptyLabel,
  'aria-label': ariaLabel,
  onChange,
}: TargetSelectProps): ReactElement {
  const selected = value === null || value === UNWIRED ? EMPTY_VALUE : value;
  // A target the document no longer has still shows, so the select never lies about the wiring.
  const names =
    selected === EMPTY_VALUE || stepNames.includes(selected) ? stepNames : [selected, ...stepNames];
  const items = [
    { value: EMPTY_VALUE, label: emptyLabel },
    ...names.map((name) => ({ value: name, label: name })),
  ];

  return (
    <Select
      aria-label={ariaLabel}
      items={items}
      value={selected}
      disabled={readOnly}
      className="h-8 w-48 shrink-0"
      onValueChange={(next) => onChange(next === EMPTY_VALUE ? null : next)}
    />
  );
}
