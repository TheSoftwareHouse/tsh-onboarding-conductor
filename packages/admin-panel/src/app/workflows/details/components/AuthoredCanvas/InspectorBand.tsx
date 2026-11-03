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

/** One band of the inspector: full width, a hairline below, a small-caps title that sticks while its band scrolls. */
export function InspectorBand({
  title,
  meta,
  trailing,
  children,
}: InspectorBandProps): ReactElement {
  return (
    <section className="flex flex-col gap-3.5 border-b border-border-hair px-6 pb-5">
      {/* The negative margin cancels the bottom padding in flow, so it only shows while stuck. */}
      <div className="sticky top-0 z-1 -mx-6 -mb-2 flex items-center justify-between gap-3 bg-bg-page px-6 pt-5 pb-2">
        <div className="flex items-baseline gap-3">
          <Typography variant="caps-tiny" as="h3" className="text-fg-3">
            {title}
          </Typography>
          {meta !== undefined && (
            <Typography variant="meta" as="span">
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
