import { useId, type ReactElement, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';

export interface FieldRowProps {
  label: string;
  required: boolean;
  onRemove?: () => void;
  /** Muted help under the label. */
  hint?: string;
  children: ReactNode;
}

/** A label above its control, with a remove button when the member can be dropped. */
export function FieldRow({
  label,
  required,
  onRemove,
  hint,
  children,
}: FieldRowProps): ReactElement {
  const labelId = useId();
  const hintId = useId();

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center justify-between">
        <Typography id={labelId} variant="meta" as="span" className="font-medium text-fg-1">
          {label}
          {required && <span className="text-tsh-red"> *</span>}
        </Typography>
        {onRemove && (
          <Button
            variant="quiet"
            size="sm"
            className="h-6 px-1"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            <Close aria-hidden className="size-4" />
          </Button>
        )}
      </div>
      {hint && (
        <Typography id={hintId} variant="meta" className="leading-4">
          {hint}
        </Typography>
      )}
      {children}
    </div>
  );
}
