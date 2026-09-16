import type { ReactElement, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { tv } from '@/lib/tv';

export interface FilterTabsProps {
  /** Names the landmark, so assistive technology can tell this tab strip from any other nav. */
  label: string;
  children: ReactNode;
}

/** The design's tab strip: a row of filter shortcuts sharing one bottom rule. */
export function FilterTabs({ label, children }: FilterTabsProps): ReactElement {
  return (
    <nav aria-label={label} className="flex items-end border-b border-border-rule px-8">
      {children}
    </nav>
  );
}

const tab = tv({
  base: 'mr-8 border-b-2 py-4 text-body-md no-underline last:mr-0',
  variants: {
    active: {
      true: 'border-tsh-black text-fg-1',
      false: 'border-transparent text-fg-3',
    },
  },
});

const count = tv({
  base: 'font-mono text-mono',
  variants: {
    active: {
      true: 'text-fg-4',
      false: 'text-tsh-gray-400',
    },
  },
});

export interface FilterTabProps {
  to: LinkProps['to'];
  active: boolean;
  /** Rendered in mono next to the label; absent means no number at all, not a placeholder. */
  count?: number;
  children: ReactNode;
}

export function FilterTab({
  to,
  active,
  count: countValue,
  children,
}: FilterTabProps): ReactElement {
  return (
    <Link to={to} aria-current={active ? 'page' : undefined} className={tab({ active })}>
      {children}
      {countValue === undefined ? null : (
        <>
          {' '}
          <span className={count({ active })}>{countValue}</span>
        </>
      )}
    </Link>
  );
}
