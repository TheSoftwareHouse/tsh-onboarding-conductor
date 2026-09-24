/**
 * What the router hands a section page so it renders its own header band. It sits outside the
 * routes because a route may not reach into `app/` — by alias or relatively — and every section
 * page needs to state the shape it is called with. It lives in `lib/` rather than `constants/`
 * because it declares no constant: `lib/pagination.ts` likewise carries `PaginationWindow`.
 */
export interface AdminPageProps {
  /** Line above the title, naming the sidebar group the page sits under. */
  eyebrow: string;
  title: string;
}
