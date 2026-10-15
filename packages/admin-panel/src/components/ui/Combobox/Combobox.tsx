import type { ReactElement, UIEvent } from 'react';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Typography } from '@/components/ui/Typography/Typography';
import { Close } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export interface ComboboxItem {
  value: string;
  label: string;
  /** Secondary line under the label, such as an id or scope. */
  description?: string;
}

export interface ComboboxProps {
  /** Items to list as given: the parent filters them (for example on the server). */
  items: readonly ComboboxItem[];
  /** The selected item, or `null`. */
  value: ComboboxItem | null;
  onValueChange: (item: ComboboxItem | null) => void;
  /** The text in the input. */
  inputValue: string;
  /** `reason` tells typing (`input-change`) apart from Base UI writing the input, such as a chosen item's label. */
  onInputValueChange: (text: string, reason: ComboboxInputReason) => void;
  /** Names the input when no visible `<label>` points at it. */
  'aria-label'?: string;
  /** Id of the input, so a `<label htmlFor>` can name it. */
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Marks the input invalid. */
  invalid?: boolean;
  /** Shows the loading row. */
  loading?: boolean;
  loadingText?: string;
  /** Shows the error row, with this text. */
  error?: string | null;
  /** Shown when the list is empty and neither loading nor failed. */
  emptyText?: string;
  /** Called when the list is scrolled to its end, to fetch the next page. */
  onLoadMore?: () => void;
  className?: string;
}

export type ComboboxInputReason = BaseCombobox.Root.ChangeEventDetails['reason'];

// How close to the end of the list, in pixels, a scroll asks for more.
const LOAD_MORE_THRESHOLD_PX = 48;

/** Server-driven combobox: the parent owns the input text, the selection and the filtering. */
export function Combobox({
  items,
  value,
  onValueChange,
  inputValue,
  onInputValueChange,
  'aria-label': ariaLabel,
  id,
  placeholder,
  disabled,
  invalid,
  loading = false,
  loadingText = 'Loading…',
  error = null,
  emptyText = 'No results',
  onLoadMore,
  className,
}: ComboboxProps): ReactElement {
  const handleScroll = ({ currentTarget }: UIEvent<HTMLDivElement>): void => {
    const { scrollTop, clientHeight, scrollHeight } = currentTarget;
    if (scrollHeight - scrollTop - clientHeight <= LOAD_MORE_THRESHOLD_PX) {
      onLoadMore?.();
    }
  };

  return (
    <BaseCombobox.Root<ComboboxItem>
      items={items}
      filter={null}
      value={value}
      onValueChange={onValueChange}
      inputValue={inputValue}
      onInputValueChange={(text, { reason }) => onInputValueChange(text, reason)}
      isItemEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
    >
      <div className="relative">
        <BaseCombobox.Input
          id={id}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          className={cn(
            'h-10 w-full rounded-none border border-border-strong bg-bg-page pr-9 pl-3 text-body-sm text-fg-1 enabled:hover:border-tsh-black disabled:text-fg-disabled aria-invalid:border-tsh-red',
            className,
          )}
        />
        <BaseCombobox.Clear
          aria-label="Clear"
          className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center text-fg-3 hover:text-fg-1"
        >
          <Close aria-hidden className="size-4" />
        </BaseCombobox.Clear>
      </div>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={4} className="z-30">
          <BaseCombobox.Popup
            onScroll={onLoadMore === undefined ? undefined : handleScroll}
            className="max-h-72 w-(--anchor-width) overflow-y-auto border border-border-strong bg-bg-page text-body-sm text-fg-1"
          >
            {error ? (
              <div role="alert" className="px-3 py-2 text-tsh-red">
                {error}
              </div>
            ) : null}
            <BaseCombobox.Empty className={loading || error ? undefined : 'px-3 py-2 text-fg-3'}>
              {loading || error ? null : emptyText}
            </BaseCombobox.Empty>
            <BaseCombobox.List>
              {(entry: ComboboxItem) => (
                <BaseCombobox.Item
                  key={entry.value}
                  value={entry}
                  className="flex cursor-pointer flex-col gap-0.5 px-3 py-2 data-highlighted:bg-bg-subtle data-selected:font-medium"
                >
                  <span>{entry.label}</span>
                  {entry.description ? (
                    <Typography variant="meta">{entry.description}</Typography>
                  ) : null}
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
            {loading ? (
              <div role="status" className="px-3 py-2 text-fg-3">
                {loadingText}
              </div>
            ) : null}
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
