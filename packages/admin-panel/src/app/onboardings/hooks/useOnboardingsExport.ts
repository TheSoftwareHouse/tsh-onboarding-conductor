import { useMutation } from '@tanstack/react-query';
import {
  fetchAdminOnboardingsCsv,
  type AdminOnboardingExportFilters,
  type AdminOnboardingsExportError,
} from '@/api/onboardings/onboardings-export';
import { showErrorToast } from '@/components/ui/Toast/toast-manager';
import { toDateTimeLocalValue } from '@/lib/datetime-local';
import { downloadFile } from '@/lib/download-file';

export interface UseOnboardingsExportResult {
  /** Downloads every onboarding matching the committed criteria as a CSV file. */
  exportCsv: (filters: AdminOnboardingExportFilters) => void;
  pending: boolean;
}

/** Fetches the CSV and hands it to the browser as a download; a failure surfaces as a toast. */
export function useOnboardingsExport(): UseOnboardingsExportResult {
  const { mutate, isPending } = useMutation<
    Blob,
    AdminOnboardingsExportError,
    AdminOnboardingExportFilters
  >({
    mutationFn: fetchAdminOnboardingsCsv,
    onSuccess: (blob) => {
      // Local wall-clock minute; `:` becomes `-` because Windows refuses it in a filename.
      downloadFile(blob, `onboardings-${toDateTimeLocalValue(new Date()).replace(':', '-')}.csv`);
    },
    onError: (error) => {
      showErrorToast('Export failed', error.message);
    },
  });

  return { exportCsv: mutate, pending: isPending };
}
