import type { ChangeEvent, FormEvent, ReactElement } from 'react';
import { Search } from '../icons';

export interface SearchInputProps {
  /** Accessible name; the design shows no visible label. */
  label: string;
  placeholder?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** Enter, or the form's submit. */
  onSubmit: () => void;
}

/** The design's header search box: a leading icon, a borderless input, Enter to commit. */
export function SearchInput({
  label,
  placeholder,
  value,
  disabled,
  onChange,
  onSubmit,
}: SearchInputProps): ReactElement {
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className="flex h-10 min-w-70 items-center gap-2 border border-border-strong px-3"
    >
      <Search aria-hidden className="size-4.5 flex-none text-fg-4" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        className="w-full min-w-0 border-0 bg-transparent text-body-sm text-fg-1 outline-none disabled:text-fg-disabled"
      />
    </form>
  );
}
