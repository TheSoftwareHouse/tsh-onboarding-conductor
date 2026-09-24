import { type FormEvent, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../Button/Button';
import { Chip } from '../../Chip/Chip';

export interface FilterPanelError {
  /** Element id the offending controls point at with `aria-describedby`. */
  id: string;
  message: string | null;
}

export interface FilterPanelProps {
  /** Accessible name for the form, naming the list it narrows. */
  label: string;
  /**
   * How many criteria the *committed* set - the one carried in the URL - narrows by, never the
   * draft. The chip and the shareable-link note both describe the list as it currently stands and
   * the link that reproduces it, so a criterion only counts once Apply has put it in the URL.
   * Zero hides both.
   */
  appliedCount: number;
  disabled: boolean;
  /**
   * One message area for the whole panel rather than one per field, so a criterion spanning two
   * controls stays describable by a single element and the grid never reflows as messages appear.
   */
  error?: FilterPanelError;
  /**
   * Shortcuts that set a criterion outright rather than being typed into. Rendered beside the
   * "N active" chip, since giving them a cell of their own would break the grid's even rows.
   */
  shortcuts?: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
  children: ReactNode;
}

/**
 * Surface every filterable admin list is narrowed from: the criterion grid, the panel's
 * validation message, and the Apply/Reload/Reset actions.
 *
 * Every list renders this one panel, so the filters read, submit, and reset the same wherever
 * they appear; a section only supplies the fields that are its own.
 */
export function FilterPanel({
  label,
  appliedCount,
  disabled,
  error,
  shortcuts,
  onSubmit,
  onReset,
  onReload,
  children,
}: FilterPanelProps): ReactElement {
  return (
    <form
      className="flex flex-none flex-col gap-4 border-b border-border-rule bg-bg-subtle px-8 pt-5 pb-4"
      aria-label={label}
      onSubmit={onSubmit}
      onReset={onReset}
    >
      {/*
        Wraps rather than shrinking past a readable width, so no criterion is ever clipped.
        Cells align to the top, not the bottom: a field carrying anything under its control — the
        time zone note, the revealed custom bounds — is taller than the rest, and aligning on the
        bottom edge would lift that one field's label and control out of line with every other.
      */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] items-start gap-x-6 gap-y-4">
        {children}
      </div>
      {error !== undefined && (
        <p id={error.id} className="text-body-sm text-tsh-red" hidden={error.message === null}>
          {error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-border-hair pt-4">
        <Button type="submit" variant="primary" size="lg" disabled={disabled}>
          Apply filters
        </Button>
        <Button variant="secondary" size="lg" disabled={disabled} onClick={onReload}>
          Reload
        </Button>
        <Button type="reset" variant="quiet" size="lg" disabled={disabled}>
          Reset filters
        </Button>
        <div className="ml-auto flex items-center gap-2 text-body-sm text-fg-3">
          {shortcuts}
          {appliedCount > 0 && (
            <>
              <Chip tone="strong" className="font-medium">
                {appliedCount} active
              </Chip>
              <span>Saved as a shareable link</span>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
