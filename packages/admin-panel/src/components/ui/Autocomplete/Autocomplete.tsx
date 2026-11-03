import type { ReactElement } from 'react';
import { Autocomplete as BaseAutocomplete } from '@base-ui/react/autocomplete';
import { input, type InputFont, type InputSize } from '@/components/ui/Input/Input';
import { Typography } from '@/components/ui/Typography/Typography';

export interface AutocompleteItem {
  value: string;
  /** Secondary text beside the value, such as a type. */
  description?: string;
}

export interface AutocompleteProps {
  items: readonly AutocompleteItem[];
  value: string;
  onValueChange: (value: string) => void;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  placeholder?: string;
  disabled?: boolean;
  font?: InputFont;
  size?: InputSize;
  className?: string;
}

/** A text input that lists `items` on click and narrows them as it is typed in; any text is kept, a suggestion only fills it. */
export function Autocomplete({
  items,
  value,
  onValueChange,
  placeholder,
  disabled,
  font,
  size,
  className,
  ...aria
}: AutocompleteProps): ReactElement {
  return (
    <BaseAutocomplete.Root
      items={items}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      itemToStringValue={(item) => item.value}
      openOnInputClick
      disabled={disabled}
    >
      <BaseAutocomplete.Input
        {...aria}
        placeholder={placeholder}
        className={input({ font, size, className })}
      />
      <BaseAutocomplete.Portal>
        <BaseAutocomplete.Positioner sideOffset={4} className="z-50">
          <BaseAutocomplete.Popup className="max-h-72 min-w-(--anchor-width) overflow-y-auto border border-border-strong bg-tsh-white py-1 outline-none data-empty:hidden">
            <BaseAutocomplete.List>
              {(item: AutocompleteItem) => (
                <BaseAutocomplete.Item
                  key={item.value}
                  value={item}
                  className="flex cursor-default items-baseline justify-between gap-3 px-3 py-2 font-mono text-mono text-tsh-black outline-none data-highlighted:bg-bg-subtle"
                >
                  <span className="truncate">{item.value}</span>
                  {item.description !== undefined && (
                    <Typography variant="meta" as="span" className="shrink-0">
                      {item.description}
                    </Typography>
                  )}
                </BaseAutocomplete.Item>
              )}
            </BaseAutocomplete.List>
          </BaseAutocomplete.Popup>
        </BaseAutocomplete.Positioner>
      </BaseAutocomplete.Portal>
    </BaseAutocomplete.Root>
  );
}
