import type { ReactElement } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '@/lib/cn';
import { Typography, type TypographyVariant } from '@/components/ui/Typography/Typography';

export interface TextLinkProps extends LinkProps {
  /** `body-sm` for a line of running text, `mono` for an id or count. */
  variant?: Extract<TypographyVariant, 'body-sm' | 'mono'>;
}

/** The design's underlined in-app link: a grey underline that darkens on hover. */
export function TextLink({ variant = 'body-sm', className, ...rest }: TextLinkProps): ReactElement {
  return (
    <Typography
      as={Link}
      variant={variant}
      className={cn(
        'text-fg-1 underline decoration-border-strong underline-offset-[3px] hover:decoration-tsh-black',
        className,
      )}
      {...rest}
    />
  );
}
