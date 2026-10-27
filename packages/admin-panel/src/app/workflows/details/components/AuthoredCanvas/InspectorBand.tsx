import type { ReactElement, ReactNode } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';

export interface InspectorBandProps {
  title: string;
  /** Short text beside the title, such as a count. */
  meta?: ReactNode;
  /** A control pushed to the band's far edge. */
  trailing?: ReactNode;
  children: ReactNode;
}

/** One band of the inspector: full width, a hairline below, a small-caps title. */
export function InspectorBand({
  title,
  meta,
  trailing,
  children,
}: InspectorBandProps): ReactElement {
  return (
    <section className="flex flex-col gap-3.5 border-b border-border-hair px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <Typography variant="caps-tiny" as="h3" className="text-fg-3">
            {title}
          </Typography>
          {meta !== undefined && (
            <Typography variant="caption" as="span">
              {meta}
            </Typography>
          )}
        </div>
        {trailing}
      </div>
      {children}
    </section>
  );
}
