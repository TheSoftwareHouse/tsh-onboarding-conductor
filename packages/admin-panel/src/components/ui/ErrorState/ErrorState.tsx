import type { ReactElement, ReactNode } from 'react';
import { ErrorIcon, Lock, UnknownDocument } from '../icons';
import { StateLayout } from '../StateLayout';

export interface ErrorStateProps {
  /** `error`: the read failed. `notFound`: the ID matches nothing. `denied`: the role may not read it. */
  kind?: 'error' | 'notFound' | 'denied'; // default 'error'
  layout?: 'page' | 'section'; // default 'page'
  title: string;
  body?: string;
  /** Buttons or links: in `page` a primary `lg` Button, in `section` a secondary `md` one. */
  actions?: ReactNode;
  className?: string;
}

const ICONS = { error: ErrorIcon, notFound: UnknownDocument, denied: Lock } as const;

/** A read that failed, matched nothing, or was refused. */
export function ErrorState({ kind = 'error', ...rest }: ErrorStateProps): ReactElement {
  return (
    <StateLayout
      {...rest}
      icon={ICONS[kind]}
      iconClassName={kind === 'error' ? 'text-tsh-red' : 'text-fg-1'}
      role={kind === 'notFound' ? 'status' : 'alert'}
    />
  );
}
