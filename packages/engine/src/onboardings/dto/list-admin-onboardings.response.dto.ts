import { PaginatedMetaResponseDto } from '../../pagination';
import type { AdminOnboardingSummary } from '../onboardings.service';

/**
 * One page of admin onboarding summaries. Mirrors the audit list envelope so the admin panel
 * reads every paginated endpoint the same way.
 */
export class ListAdminOnboardingsResponseDto {
  items!: AdminOnboardingSummary[];
  meta!: PaginatedMetaResponseDto;
}
