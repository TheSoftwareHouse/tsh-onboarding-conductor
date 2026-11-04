import type { ReactElement } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import type { InputFont } from '@/components/ui/Input/Input';
import { cn } from '@/lib/cn';
import { tv } from '@/lib/tv';

const select = tv({
  slots: {
    trigger:
      'flex h-10 w-full items-center justify-between gap-2 rounded-none border border-border-strong bg-tsh-white px-3 text-left text-tsh-black enabled:hover:border-tsh-black disabled:bg-bg-subtle disabled:text-fg-disabled aria-invalid:border-tsh-red',
    item: 'flex cursor-default items-center px-3 py-2 text-tsh-black outline-none data-highlighted:bg-bg-subtle data-selected:bg-bg-alt',
  },
  variants: {
    font: {
      text: { trigger: 'text-body-sm', item: 'text-body-sm' },
      mono: { trigger: 'font-mono text-mono', item: 'font-mono text-mono' },
    },
  },
});

export interface SelectItem<Value extends string> {
  value: Value;
  label: string;
}

export interface SelectProps<Value extends string> {
  items: readonly SelectItem<Value>[];
  /** `null` shows the placeholder. */
  value: Value | null;
  /** Reports `null` only when `anyOptionLabel` is set. */
  onValueChange: (value: Value | null) => void;
  /** Adds a first item with value `null` and this label. */
  anyOptionLabel?: string;
  /** Defaults to `mono`, the New draft dialog's look. */
  font?: InputFont;
  /** Names the control when no visible label points at `id`. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Controlled Base UI select, styled like the panel's native select (`h-10`, mono text). */
export function Select<Value extends string>({
  items,
  value,
  onValueChange,
  anyOptionLabel,
  font = 'mono',
  placeholder = 'Choose an option',
  className,
  ...rest
}: SelectProps<Value>): ReactElement {
  const { trigger, item: itemClass } = select({ font });
  const allItems: readonly { value: Value | null; label: string }[] =
    anyOptionLabel === undefined ? items : [{ value: null, label: anyOptionLabel }, ...items];

  return (
    <BaseSelect.Root
      items={allItems}
      value={value}
      onValueChange={(next) => {
        if (next !== null || anyOptionLabel !== undefined) onValueChange(next);
      }}
      id={rest.id}
      name={rest.name}
      disabled={rest.disabled}
    >
      <BaseSelect.Trigger
        aria-label={rest['aria-label']}
        aria-describedby={rest['aria-describedby']}
        aria-invalid={rest['aria-invalid']}
        className={cn(trigger(), className)}
      >
        <BaseSelect.Value
          placeholder={placeholder}
          className="truncate data-placeholder:text-fg-3"
        />
        <BaseSelect.Icon aria-hidden className="shrink-0 text-fg-3">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor">
            <path d="M1 1l4 4 4-4" strokeWidth="1.5" />
          </svg>
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <BaseSelect.Popup className="max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto border border-border-strong bg-tsh-white py-1 outline-none">
            {allItems.map((item) => (
              <BaseSelect.Item key={item.value ?? ''} value={item.value} className={itemClass()}>
                <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
