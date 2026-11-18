import type { ReactElement, ReactNode } from 'react';
import { tv } from '@/lib/tv';
import type { IconComponent } from './icons';
import { Typography } from './Typography/Typography';

const stateLayout = tv({
  slots: {
    root: '',
    icon: 'shrink-0',
    text: 'flex flex-col',
    actions: 'flex flex-wrap',
  },
  variants: {
    layout: {
      page: {
        root: 'mx-auto flex min-h-60 w-full max-w-140 flex-1 flex-col items-center justify-center gap-4 px-8 text-center',
        icon: 'size-8',
        text: 'items-center gap-2',
        actions: 'justify-center gap-3 pt-2',
      },
      section: {
        root: 'flex flex-wrap items-start gap-x-4 gap-y-3 border border-border-rule bg-bg-subtle px-6 py-5',
        icon: 'size-5',
        text: 'min-w-0 flex-[1_1_17.5rem] gap-1',
        actions: 'items-center gap-2 self-center',
      },
    },
  },
  defaultVariants: { layout: 'page' },
});

export interface StateLayoutProps {
  layout?: 'page' | 'section';
  title: string;
  body?: string;
  /** Buttons or links: in `page` a primary `lg` Button, in `section` a secondary `md` one. */
  actions?: ReactNode;
  className?: string;
  icon: IconComponent;
  iconClassName: string;
  role: 'status' | 'alert';
}

/** The shared layout behind `EmptyState` and `ErrorState`; use those, not this. */
export function StateLayout({
  layout = 'page',
  title,
  body,
  actions,
  className,
  icon: Icon,
  iconClassName,
  role,
}: StateLayoutProps): ReactElement {
  const slots = stateLayout({ layout });
  const isPage = layout === 'page';

  return (
    <div role={role} className={slots.root({ className })}>
      <Icon
        aria-hidden="true"
        focusable="false"
        className={slots.icon({ className: iconClassName })}
      />
      <div className={slots.text()}>
        {isPage ? (
          <Typography as="h2" variant="h6">
            {title}
          </Typography>
        ) : (
          <Typography as="h3" variant="body-md" className="font-medium">
            {title}
          </Typography>
        )}
        {body ? <Typography variant={isPage ? 'body-md' : 'body-sm'}>{body}</Typography> : null}
      </div>
      {actions ? <div className={slots.actions()}>{actions}</div> : null}
    </div>
  );
}
