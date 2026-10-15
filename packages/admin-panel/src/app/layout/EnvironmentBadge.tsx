import type { ReactElement } from 'react';
import { Chip } from '@/components/ui/Chip/Chip';
import { findEnvironment } from '@/config/environment';

/**
 * Names the environment an operator is acting on, so a change meant for staging is not made on
 * prod by mistake. An engine running with `NODE_ENV=production` is drawn in red whatever it is called.
 */
export function EnvironmentBadge(): ReactElement | null {
  const environment = findEnvironment();

  if (environment === undefined) {
    return null;
  }

  return (
    <Chip
      tone={environment.isProduction ? 'danger' : 'neutral'}
      size="status"
      title={environment.isProduction ? 'Production' : 'Development'}
    >
      {environment.name}
    </Chip>
  );
}
