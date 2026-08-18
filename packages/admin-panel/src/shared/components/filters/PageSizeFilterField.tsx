import type { ReactElement } from 'react';
import { PAGE_SIZES, type PageSize } from '@/shared/lib/pagination';
import { SelectFilterField } from './SelectFilterField';

export interface PageSizeFilterFieldProps {
  value: PageSize;
  disabled: boolean;
  onChange: (value: PageSize) => void;
}

const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((pageSize) => ({
  value: String(pageSize),
  label: String(pageSize),
}));

/**
 * Rows-per-page criterion, offered from the shared `PAGE_SIZES` so no selection can be refused
 * by the engine's own pagination limit. Every paginated list offers the same choice, so it is
 * declared once here rather than per section.
 */
export function PageSizeFilterField({
  value,
  disabled,
  onChange,
}: PageSizeFilterFieldProps): ReactElement {
  return (
    <SelectFilterField
      id="page-size-filter"
      name="limit"
      label="Per page"
      value={String(value)}
      options={PAGE_SIZE_OPTIONS}
      disabled={disabled}
      onChange={(pageSize: string) => onChange(Number(pageSize) as PageSize)}
    />
  );
}
