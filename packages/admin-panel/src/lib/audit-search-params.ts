import { createSerializer, type inferParserType } from 'nuqs';
import { parseAsTrimmedString } from './search-params';

/** The type an onboarding's audit rows are filed under, named once for everyone addressing them. */
export const ONBOARDING_AUDIT_RESOURCE_TYPE = 'onboarding';

/** The resource criteria of an audit row, shared so links into Logs use the page's own param names. */
export const auditResourceSearchParams = {
  resourceType: parseAsTrimmedString,
  resourceId: parseAsTrimmedString,
};

export type AuditResourceSearchValues = inferParserType<typeof auditResourceSearchParams>;

const serialize = createSerializer(auditResourceSearchParams);

/** Query string opening the trail filtered to one resource, '' when neither criterion is stated. */
export function serializeAuditResourceSearch(values: AuditResourceSearchValues): string {
  return serialize(values);
}
