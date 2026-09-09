import {
  Children,
  type CSSProperties,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { chooseFilterColumns } from '@/shared/lib/filter-grid';
import { Button } from '../Button/Button';

/** Validation message a panel shows for the criteria it refused, wired to a control by id. */
export interface FilterPanelError {
  /** Element id the offending controls point at with `aria-describedby`. */
  id: string;
  /** Why the criteria were refused, or null while they are valid. */
  message: string | null;
}

export interface FilterPanelProps {
  /** Accessible name for the form, naming the list it narrows. */
  label: string;
  /**
   * How many criteria the draft currently narrows by, summarized in the header so the operator
   * can see at a glance that the list is filtered. Zero hides the summary.
   */
  activeCount: number;
  disabled: boolean;
  /**
   * Single validation message for the whole panel, rendered above the actions. One message area
   * per panel keeps a criterion spanning two controls - a from/to window - describable by one
   * element, and keeps the field grid from reflowing as messages appear.
   */
  error?: FilterPanelError;
  /**
   * Shortcuts that set a criterion outright rather than being typed into, shown at the trailing
   * edge of the header. They live there because they are not fields: giving them a cell of their
   * own would break the grid's even rows and leave the header's own row half empty.
   */
  shortcuts?: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
  /** The criterion fields, one element each, laid out in the panel's responsive grid. */
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
  activeCount,
  disabled,
  error,
  shortcuts,
  onSubmit,
  onReset,
  onReload,
  children,
}: FilterPanelProps): ReactElement {
  // Taken from how many fields the section supplies, so the last row is as full as the first one
  // however many criteria a list is narrowed by.
  const gridStyle = {
    '--filter-columns': chooseFilterColumns(Children.count(children)),
  } as CSSProperties;

  return (
    <form className="filter-panel" aria-label={label} onSubmit={onSubmit} onReset={onReset}>
      <div className="filter-panel__header">
        <span className="filter-panel__title">Filters</span>
        {activeCount > 0 && <span className="filter-panel__count">{activeCount} active</span>}
        {shortcuts !== undefined && <div className="filter-panel__shortcuts">{shortcuts}</div>}
      </div>
      <div className="filter-panel__grid" style={gridStyle}>
        {children}
      </div>
      {error !== undefined && (
        <p id={error.id} className="field-error" hidden={error.message === null}>
          {error.message}
        </p>
      )}
      <div className="filter-panel__actions">
        <Button type="submit" variant="primary" disabled={disabled}>
          Apply filters
        </Button>
        <Button disabled={disabled} onClick={onReload}>
          Reload
        </Button>
        <Button type="reset" variant="quiet" disabled={disabled}>
          Reset filters
        </Button>
      </div>
    </form>
  );
}
