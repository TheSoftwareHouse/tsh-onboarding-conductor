import type { KeyboardEvent, ReactElement } from 'react';
import { useState } from 'react';
import { resolvePageJump, type PaginationWindow } from '@/lib/pagination';
import { Button } from '../Button/Button';

/**
 * Only one pager is rendered per view, so the input carries a fixed id, as the shared page-size
 * control does.
 */
const PAGE_INPUT_ID = 'pagination-page';

export interface PaginationProps {
  pagination: PaginationWindow;
  /** Accessible name for the pager, naming the list it steps through. */
  label: string;
  disabled: boolean;
  onPageChange: (page: number) => void;
}

/**
 * Steps through the pages an endpoint reported, or jumps straight to one the operator names.
 * The endpoints paginate server-side, so moving page issues a new request rather than slicing
 * rows the panel already holds. A typed page is committed on Enter and only then requested;
 * leaving the box without committing puts the current page back.
 */
export function Pagination({
  pagination,
  label,
  disabled,
  onPageChange,
}: PaginationProps): ReactElement {
  const { page, totalPages } = pagination;
  const [draftPage, setDraftPage] = useState(() => String(page));
  const [shownPage, setShownPage] = useState(page);

  // The endpoint's page is the source of truth: a page reached with the arrows, or one it
  // clamped, replaces whatever the box holds. Adjusted while rendering rather than in an effect
  // so the pager never paints a page it has already left.
  if (shownPage !== page) {
    setShownPage(page);
    setDraftPage(String(page));
  }

  const commitDraftPage = (): void => {
    const requested = resolvePageJump(draftPage, totalPages);

    if (requested === null) {
      setDraftPage(String(page));
      return;
    }

    setDraftPage(String(requested));

    if (requested !== page) {
      onPageChange(requested);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      // The pager is not a form, so Enter would otherwise do nothing here.
      event.preventDefault();
      commitDraftPage();
    }
  };

  return (
    <nav className="flex items-center gap-2" aria-label={label}>
      <Button
        size="sm"
        className="h-9 px-4 text-body-sm"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <div className="flex items-center gap-2 text-body-sm text-fg-3">
        <label htmlFor={PAGE_INPUT_ID}>Page</label>
        <input
          id={PAGE_INPUT_ID}
          className="h-9 w-14 rounded-none border border-border-strong bg-bg-page text-center font-mono text-body-sm text-fg-1"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-describedby={`${PAGE_INPUT_ID}-total`}
          disabled={disabled}
          value={draftPage}
          onChange={(event) => setDraftPage(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setDraftPage(String(page))}
        />
        <span id={`${PAGE_INPUT_ID}-total`}>of {totalPages}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-9 px-4 text-body-sm"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
