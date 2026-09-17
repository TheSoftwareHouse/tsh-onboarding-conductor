import type {
  HTMLAttributes,
  ReactElement,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';
import { tv } from '@/lib/tv';

export interface TableSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  hidden?: boolean;
}

/** The scroll region a table lives in; the sticky header rows read against this, not the window. */
export function TableSurface({
  label,
  className,
  children,
  ...rest
}: TableSurfaceProps): ReactElement {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn('flex-1 overflow-auto', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  caption: string;
}

/** A `<caption>` names the table for assistive tech without a redundant visible heading. */
export function Table({ caption, className, children, ...rest }: TableProps): ReactElement {
  return (
    <table className={cn('w-full border-collapse', className)} {...rest}>
      <caption className="sr-only">{caption}</caption>
      {children}
    </table>
  );
}

export interface ThProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: 'start' | 'end';
}

const th = tv({
  base: 'sticky top-0 z-1 border-b border-border-strong bg-bg-page px-4 py-3 text-left text-caps-tiny text-fg-3 uppercase',
  variants: {
    align: {
      start: '',
      end: 'text-right',
    },
  },
  defaultVariants: { align: 'start' },
});

export function Th({ align, className, ...rest }: ThProps): ReactElement {
  return <th className={th({ align, className })} {...rest} />;
}

export type TdVariant = 'text' | 'mono' | 'nowrap' | 'wrap' | 'end';

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  variant?: TdVariant;
}

const td = tv({
  base: 'border-b border-border-hair px-4 py-3.5 align-top',
  variants: {
    variant: {
      text: 'text-body-sm text-fg-2',
      mono: 'font-mono text-mono text-fg-2',
      nowrap: 'text-body-sm whitespace-nowrap text-fg-3',
      wrap: 'text-body-sm wrap-break-word whitespace-normal text-fg-2',
      end: 'text-right text-body-sm text-fg-2',
    },
  },
  defaultVariants: { variant: 'text' },
});

export function Td({ variant, className, ...rest }: TdProps): ReactElement {
  return <td className={td({ variant, className })} {...rest} />;
}

export interface TableEmptyRowProps {
  colSpan: number;
  children: ReactNode;
}

/** The row a table renders instead of data, spanning every column so the message stays centred. */
export function TableEmptyRow({ colSpan, children }: TableEmptyRowProps): ReactElement {
  return (
    <tr>
      <Td colSpan={colSpan} className="text-center text-fg-4">
        {children}
      </Td>
    </tr>
  );
}
