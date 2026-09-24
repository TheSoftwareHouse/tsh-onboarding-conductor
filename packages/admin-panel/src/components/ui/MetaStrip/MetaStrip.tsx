import type { ReactElement, ReactNode } from 'react';
import { Children, Fragment } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import { tv } from '@/lib/tv';

export interface MetaStripProps {
  children: ReactNode;
}

/** The run-meta band: `MetaStripItem`s joined by hairline dividers that never lead or trail. */
export function MetaStrip({ children }: MetaStripProps): ReactElement {
  const items = Children.toArray(children);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-border-hair bg-bg-subtle px-8 py-2.5">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true" className="w-px self-stretch bg-border-hair" />}
          {item}
        </Fragment>
      ))}
    </div>
  );
}

const itemValue = tv({
  base: 'whitespace-nowrap text-fg-1',
  variants: {
    highlighted: {
      true: 'bg-tsh-yellow-400 px-1.5 py-px',
      false: '',
    },
  },
  defaultVariants: { highlighted: false },
});

export interface MetaStripItemProps {
  label: ReactNode;
  value: ReactNode;
  /** The design's amber treatment for the current step's running duration. */
  highlighted?: boolean;
}

export function MetaStripItem({ label, value, highlighted }: MetaStripItemProps): ReactElement {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <Typography variant="caps-tiny" as="span" className="shrink-0 text-fg-4">
        {label}
      </Typography>
      <Typography variant="mono" as="span" className={itemValue({ highlighted })}>
        {value}
      </Typography>
    </div>
  );
}
