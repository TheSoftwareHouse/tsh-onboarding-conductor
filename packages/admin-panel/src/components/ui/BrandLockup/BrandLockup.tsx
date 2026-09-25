import type { ReactElement } from 'react';
import { TshSignet } from '@/components/ui/TshSignet';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';

export interface BrandLockupProps {
  className?: string;
}

/** The signet plus the product name and tagline, shared by the sidebar and the sign-in header. */
export function BrandLockup({ className }: BrandLockupProps): ReactElement {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <TshSignet className="size-7 text-tsh-black" />
      <div className="flex flex-col gap-0.5">
        <Typography variant="body-md" className="tracking-brand text-fg-1">
          Conductor
        </Typography>
        <Typography variant="caps-tiny" className="text-fg-4">
          Onboarding ops
        </Typography>
      </div>
    </div>
  );
}
