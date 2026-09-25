import type { ReactElement, ReactNode } from 'react';
import { BrandLockup } from '@/components/ui/BrandLockup/BrandLockup';

export interface AuthShellProps {
  children: ReactNode;
}

/** The header band and centred body shared by every state the auth gate can render. */
export function AuthShell({ children }: AuthShellProps): ReactElement {
  return (
    <div className="flex size-full flex-col bg-bg-subtle">
      <header className="flex h-header flex-none items-center border-b border-border-rule bg-bg-page px-8">
        <BrandLockup />
      </header>
      <main className="flex flex-1 items-center justify-center p-8">{children}</main>
    </div>
  );
}
