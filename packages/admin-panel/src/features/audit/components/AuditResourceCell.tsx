import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { ADMIN_ROUTES } from '@/shared/constants/routes';

export interface AuditResourceCellProps {
  resourceType: string;
  resourceId: string;
}

/**
 * The design's polymorphic resource cell: a link only where the panel has somewhere to send it
 * (`goDetails` / `goConnectors`), a plain span otherwise. No truncation — a resource id is what an
 * operator copies out of the trail, and an ellipsis makes it un-copyable.
 */
export function AuditResourceCell({
  resourceType,
  resourceId,
}: AuditResourceCellProps): ReactElement {
  if (resourceType === 'onboarding') {
    return <Link to={ADMIN_ROUTES.onboardings.details(resourceId)}>{resourceId}</Link>;
  }

  if (resourceType === 'connector_settings') {
    return <Link to={ADMIN_ROUTES.connectors.root}>{resourceId}</Link>;
  }

  return <span>{resourceId}</span>;
}
