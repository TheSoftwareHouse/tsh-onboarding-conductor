import type { ReactElement, ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Typography } from '@/components/ui/Typography/Typography';
import { tv } from '@/lib/tv';

export type FilterTabsOrientation = 'horizontal' | 'vertical';

export interface FilterTabsProps {
  /** Names the landmark, so assistive technology can tell this tab strip from any other nav. */
  label: string;
  /** The strip's axis; defaults to `horizontal` so existing call sites are unaffected. */
  orientation?: FilterTabsOrientation;
  children: ReactNode;
}

/** Reaches `FilterTab` without threading `orientation` through every call site. */
const FilterTabsOrientationContext = createContext<FilterTabsOrientation>('horizontal');

const tabs = tv({
  base: 'flex',
  variants: {
    orientation: {
      horizontal: 'items-end border-b border-border-rule px-8',
      vertical: 'w-filter-nav flex-col gap-6 overflow-y-auto border-r border-border-rule py-6',
    },
  },
});

/** The design's tab strip: filter shortcuts sharing one rule, horizontal or vertical. */
export function FilterTabs({
  label,
  orientation = 'horizontal',
  children,
}: FilterTabsProps): ReactElement {
  return (
    <nav aria-label={label} className={tabs({ orientation })}>
      <FilterTabsOrientationContext.Provider value={orientation}>
        {children}
      </FilterTabsOrientationContext.Provider>
    </nav>
  );
}

const tab = tv({
  base: 'text-body-md no-underline',
  variants: {
    orientation: {
      horizontal: 'mr-8 border-b-2 py-4 last:mr-0',
      vertical: 'flex items-center gap-3 border-l-3 px-6 py-3 hover:bg-bg-subtle',
    },
    active: {
      true: '',
      false: '',
    },
  },
  compoundVariants: [
    { orientation: 'horizontal', active: true, class: 'border-tsh-black text-fg-1' },
    { orientation: 'horizontal', active: false, class: 'border-transparent text-fg-3' },
    { orientation: 'vertical', active: true, class: 'border-l-tsh-black bg-bg-alt text-fg-1' },
    { orientation: 'vertical', active: false, class: 'border-l-transparent text-fg-3' },
  ],
});

const count = tv({
  base: 'font-mono',
  variants: {
    orientation: {
      horizontal: 'text-mono',
      vertical: 'ml-auto text-caps-tiny',
    },
    active: {
      true: '',
      false: 'text-tsh-gray-400',
    },
  },
  // The horizontal strip (AuditResourceTabs, OnboardingStatusTabs) keeps its active count at
  // `fg-4`; the vertical connector-type nav reads it at the darker `fg-3` instead.
  compoundVariants: [
    { orientation: 'horizontal', active: true, class: 'text-fg-4' },
    { orientation: 'vertical', active: true, class: 'text-fg-3' },
  ],
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
  const orientation = useContext(FilterTabsOrientationContext);

  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={tab({ orientation, active })}
    >
      {children}
      {countValue === undefined ? null : (
        <>
          {' '}
          <span className={count({ orientation, active })}>{countValue}</span>
        </>
      )}
    </Link>
  );
}

export interface FilterTabGroupProps {
  label: string;
  children: ReactNode;
}

/** Captioned run of tabs. Vertical only in practice; renders its label as a caps eyebrow. */
export function FilterTabGroup({ label, children }: FilterTabGroupProps): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <Typography variant="caps-tiny" className="block px-6 pb-3 text-tsh-gray-400">
        {label}
      </Typography>
      {children}
    </div>
  );
}

export interface FilterTabNoteProps {
  children: ReactNode;
}

/** A named option this build cannot offer — read, not chosen. */
export function FilterTabNote({ children }: FilterTabNoteProps): ReactElement {
  return (
    <Typography variant="body-sm" as="span" className="block px-6 py-1.5 text-tsh-gray-300">
      {children}
    </Typography>
  );
}
