import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { ProgressActivity } from '../icons';
import { Typography } from '../Typography/Typography';

export interface LoaderProps {
  /** Announced once; visible only in the inline layout. */
  label: string;
  /** `block`: a 32px spinner centred in its container. `inline`: a 16px spinner beside the visible label. */
  layout?: 'block' | 'inline';
  className?: string;
}

/** A spinner that fades in after 150 ms, so a fast load never flashes it. */
export function Loader({ label, layout = 'block', className }: LoaderProps): ReactElement {
  if (layout === 'inline') {
    return (
      <div role="status" className={cn('py-2', className)}>
        <div className="flex animate-loader-reveal items-center gap-3">
          <ProgressActivity
            aria-hidden="true"
            className="size-4 animate-spin text-fg-3 motion-reduce:animate-none"
          />
          <Typography as="span" variant="body-sm">
            {label}
          </Typography>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={cn('flex min-h-60 flex-1 flex-col items-center justify-center', className)}
    >
      <span className="sr-only">{label}</span>
      <div className="animate-loader-reveal">
        <ProgressActivity
          aria-hidden="true"
          className="size-8 animate-spin text-fg-3 motion-reduce:animate-none"
        />
      </div>
    </div>
  );
}
