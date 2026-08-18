import type { KeyboardEvent, ReactElement } from 'react';
import { useState } from 'react';
import { resolvePageJump, type PaginationWindow } from '../lib/pagination';

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
 * Every paginated admin view renders this one control, so the pager reads and behaves the same
 * wherever it appears.
 *
 * The endpoints paginate server-side, so moving page issues a new request rather than slicing
 * rows the panel already holds. A typed page is committed on Enter and only then requested;
 * leaving the box without committing puts the current page back, so the number on screen never
 * disagrees with the rows below it.
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

  // The endpoint's page is the source of truth: a page reached with the arrows, or one it clamped,
  // replaces whatever the box holds. Adjusted while rendering rather than in an effect so the
  // pager never paints a page it has already left.
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
    <nav className="pagination" aria-label={label}>
      <button type="button" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <div className="pagination__position">
        <label htmlFor={PAGE_INPUT_ID}>Page</label>
        <input
          id={PAGE_INPUT_ID}
          className="pagination__page"
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
      <button
        type="button"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
