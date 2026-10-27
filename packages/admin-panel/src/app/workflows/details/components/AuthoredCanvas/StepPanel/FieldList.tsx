import { useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Chip } from '@/components/ui/Chip/Chip';
import { Typography } from '@/components/ui/Typography/Typography';
import type { StepSection } from '../../../utils/authored-projection';

/** Past this many, a section shows the first few and a toggle, so one long section cannot bury the rest. */
const VISIBLE_FIELDS = 5;

export function FieldList({ fields }: { fields: StepSection['fields'] }): ReactElement {
  const [showAll, setShowAll] = useState(false);
  if (!Array.isArray(fields)) {
    return (
      <Typography variant="meta" className="text-tsh-red">
        {fields.error}
      </Typography>
    );
  }
  if (fields.length === 0) {
    return (
      <Typography variant="meta" className="text-fg-disabled">
        no fields
      </Typography>
    );
  }
  const isLong = fields.length > VISIBLE_FIELDS;
  const shown = isLong && !showAll ? fields.slice(0, VISIBLE_FIELDS) : fields;
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {shown.map((field) => (
          // Required is the usual case, so only an optional field says anything beyond its type.
          <li
            key={field.name}
            className="flex items-baseline justify-between gap-2 border-b border-border-hair py-1.5 last:border-b-0"
          >
            <Typography
              variant="mono"
              as="span"
              className="truncate text-caption"
              title={field.name}
            >
              {field.name}
            </Typography>
            <span className="flex shrink-0 items-baseline gap-2">
              {!field.required && <Chip tone="outline">optional</Chip>}
              <Typography variant="meta" as="span">
                {field.type}
              </Typography>
            </span>
          </li>
        ))}
      </ul>
      {isLong && (
        <Button
          variant="quiet"
          size="sm"
          className="self-start px-0"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show fewer' : `Show all ${fields.length} fields`}
        </Button>
      )}
    </div>
  );
}
