import { useContext, useId, type ReactElement, type ReactNode } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import { ClearButton } from '../EntryActions';
import { GroupDepthContext } from '../group-depth';

export interface FieldRowProps {
  label: string;
  required: boolean;
  onRemove?: () => void;
  /** Muted help under the label. */
  hint?: string;
  /** A named set of settings: a larger title, and while `open`, its controls on a tinted panel, or indented inside another group. */
  group?: { open: boolean; summary?: string };
  children: ReactNode;
}

/** A label above its control, with a remove button when the member can be dropped. */
export function FieldRow({
  label,
  required,
  onRemove,
  hint,
  group,
  children,
}: FieldRowProps): ReactElement {
  const labelId = useId();
  const hintId = useId();
  const depth = useContext(GroupDepthContext);

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-baseline gap-2">
          <Typography
            id={labelId}
            variant={group ? 'body-sm' : 'meta'}
            as="span"
            className="font-medium text-fg-1"
          >
            {label}
            {required && <span className="text-tsh-red"> *</span>}
          </Typography>
          {group?.summary && (
            <Typography variant="meta" as="span">
              {group.summary}
            </Typography>
          )}
        </span>
        {onRemove && <ClearButton label={`Remove ${label}`} onClick={onRemove} />}
      </div>
      {hint && (
        <Typography id={hintId} variant="meta" className="leading-4">
          {hint}
        </Typography>
      )}
      {group?.open ? (
        // Only an outer group is tinted; a group inside one is indented, so tint never sits on tint.
        <GroupDepthContext.Provider value={depth + 1}>
          <div className={depth === 0 ? 'bg-bg-subtle p-3' : 'border-l-2 border-border-rule pl-3'}>
            {children}
          </div>
        </GroupDepthContext.Provider>
      ) : (
        children
      )}
    </div>
  );
}
