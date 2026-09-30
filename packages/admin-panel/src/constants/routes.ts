/**
 * Every path the admin panel mounts, in one tree.
 *
 * Routes live in `shared/` rather than in the feature slices they belong to because linking is
 * inherently cross-slice: a row of the audit trail links to an onboarding's details page and to
 * Connectors, and the sidebar names all three. Declared per slice, each of those became either a
 * deep import into another slice's internals or a second copy of the literal.
 *
 * A parameterised route carries two entries because a router and a link want different things —
 * the pattern to match on, and a filled-in path. Both are built from the section's own root, so
 * renaming a section cannot half-apply.
 */

const ONBOARDINGS_ROOT = '/onboardings';
const WORKFLOWS_ROOT = '/workflows';

export const ADMIN_ROUTES = {
  onboardings: {
    root: ONBOARDINGS_ROOT,
    /** Pattern the router matches on. Not a path — `:onboardingId` is a placeholder. */
    detailsPattern: `${ONBOARDINGS_ROOT}/:onboardingId`,
    /** One onboarding's details page, which is what a list row and an audit row link to. */
    details: (onboardingId: string): string =>
      `${ONBOARDINGS_ROOT}/${encodeURIComponent(onboardingId)}`,
  },
  workflows: {
    root: WORKFLOWS_ROOT,
    /** Pattern the router matches on. Not a path — `:workflowId` is a placeholder. */
    detailsPattern: `${WORKFLOWS_ROOT}/:workflowId`,
    /** The placeholder details page a list row's id and arrow cells link to. */
    details: (workflowId: string): string => `${WORKFLOWS_ROOT}/${encodeURIComponent(workflowId)}`,
  },
  audit: {
    root: '/audit',
  },
  connectors: {
    root: '/connectors',
  },
  encryption: {
    root: '/encryption',
  },
} as const;
