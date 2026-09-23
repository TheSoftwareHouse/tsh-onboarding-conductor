import type { ReactElement } from 'react';
import { Chip, type ChipSize, type ChipTone } from '@/components/ui/Chip/Chip';
import {
  describeAdminOnboardingStatus,
  describeAdminOnboardingStatusTone,
  type AdminOnboardingStatusTone,
} from '../../types/admin-onboarding';

export interface OnboardingStatusChipProps {
  status: string;
  /** The list's rows take the default badge; the details page's header band takes the `status` pill. */
  size?: ChipSize;
}

const TONE_BY_STATUS_TONE: Record<AdminOnboardingStatusTone, ChipTone> = {
  review: 'active',
  progress: 'info',
  success: 'strong',
  failure: 'danger',
};

/** An onboarding's status as a chip, shared by the list table and the details header. */
export function OnboardingStatusChip({ status, size }: OnboardingStatusChipProps): ReactElement {
  const tone = TONE_BY_STATUS_TONE[describeAdminOnboardingStatusTone(status)];

  return (
    <Chip tone={tone} size={size}>
      {describeAdminOnboardingStatus(status)}
    </Chip>
  );
}
