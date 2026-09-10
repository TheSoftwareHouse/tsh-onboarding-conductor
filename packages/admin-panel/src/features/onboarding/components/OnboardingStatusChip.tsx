import type { ReactElement } from 'react';
import { Chip, type ChipTone } from '@/shared/components/Chip/Chip';
import {
  describeAdminOnboardingStatus,
  describeAdminOnboardingStatusTone,
  type AdminOnboardingStatusTone,
} from '../types/admin-onboarding';

export interface OnboardingStatusChipProps {
  status: string;
}

const TONE_BY_STATUS_TONE: Record<AdminOnboardingStatusTone, ChipTone> = {
  review: 'active',
  progress: 'info',
  success: 'strong',
  failure: 'danger',
};

export function OnboardingStatusChip({ status }: OnboardingStatusChipProps): ReactElement {
  const tone = TONE_BY_STATUS_TONE[describeAdminOnboardingStatusTone(status)];

  return <Chip tone={tone}>{describeAdminOnboardingStatus(status)}</Chip>;
}
