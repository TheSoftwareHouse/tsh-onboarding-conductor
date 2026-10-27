import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';
import {
  WORKFLOW_VERSION_STATUS,
  type WorkflowVersion,
  type WorkflowVersionStatus,
} from '@/api/workflows/workflow-versions';
import { Chip, type ChipTone } from '@/components/ui/Chip/Chip';
import { TextLink } from '@/components/ui/TextLink/TextLink';
import { Typography } from '@/components/ui/Typography/Typography';
import { ADMIN_ROUTES } from '@/constants/routes';
import { serializeOnboardingWorkflowSearch } from '@/lib/onboarding-search-params';

const STATUS_TONES: Record<WorkflowVersionStatus, ChipTone> = {
  published: 'strong',
  draft: 'scheduled',
  retired: 'muted',
};

export interface WorkflowDetailsHeaderProps {
  workflowId: string;
  /** The workflow's label; null falls back to the id. */
  name: string | null;
  /** Empty while the list is loading, so the picker is not drawn. */
  versions: WorkflowVersion[];
  /** The shown version; null, or one not listed, leaves the picker asking for a choice. */
  version: number | null;
  /** Query string the list handed over, carried by the breadcrumb's back link. */
  backSearch: string;
  onVersionChange: (version: number) => void;
  /** Buttons drawn under the version picker; a draft's editing actions. */
  actions?: ReactNode;
  /** Muted text beside the status chip. */
  note?: ReactNode;
}

/** The header band: breadcrumb, title, a meta line with the version chip, note and onboardings link (not on a draft), and on the right the version picker with the actions under it. */
export function WorkflowDetailsHeader({
  workflowId,
  name,
  versions,
  version,
  backSearch,
  onVersionChange,
  actions,
  note,
}: WorkflowDetailsHeaderProps): ReactElement {
  const shown = versions.find((entry) => entry.version === version);
  // A draft cannot start an onboarding, so it has none to link to.
  const showOnboardingsLink =
    versions.length > 0 && shown?.status !== WORKFLOW_VERSION_STATUS.draft;
  // Every version's onboardings, not just the shown one's.
  const onboardingsHref = `${ADMIN_ROUTES.onboardings.root}${serializeOnboardingWorkflowSearch({ workflowId })}`;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    onVersionChange(Number(event.target.value));
  };

  return (
    <header className="flex flex-none items-start justify-between gap-6 border-b border-border-rule px-8 py-5">
      <div className="flex min-w-72 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2 **:leading-natural">
          <Typography
            as={Link}
            to={{ pathname: ADMIN_ROUTES.workflows.root, search: backSearch }}
            variant="caps-tiny"
            className="text-fg-4 no-underline hover:underline"
          >
            Workflows
          </Typography>
          <Typography variant="caps-tiny" as="span" className="text-fg-4">
            /
          </Typography>
          <Typography variant="caps-tiny" as="span" className="text-tsh-black">
            {workflowId}
          </Typography>
        </div>
        <Typography variant="h5" as="h1" className="text-tsh-black">
          {name ?? workflowId}
        </Typography>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {shown !== undefined && (
            <Chip
              tone={STATUS_TONES[shown.status]}
              size="status"
              className="shrink-0 leading-natural"
            >
              v{shown.version} {shown.status}
            </Chip>
          )}
          {note !== undefined && (
            <Typography variant="body-sm" as="span" className="text-fg-3">
              {note}
            </Typography>
          )}
          {showOnboardingsLink && <TextLink to={onboardingsHref}>View onboardings →</TextLink>}
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-end gap-2">
        {versions.length > 0 && (
          <select
            aria-label="Version"
            value={shown?.version ?? ''}
            onChange={handleChange}
            className="h-10 w-52.5 shrink-0 border border-border-strong bg-tsh-white px-3 font-mono text-mono text-tsh-black"
          >
            {shown === undefined && (
              <option value="" disabled>
                Choose a version
              </option>
            )}
            {versions.map((entry) => (
              <option key={entry.version} value={entry.version}>
                v{entry.version} — {entry.status}
              </option>
            ))}
          </select>
        )}
        {actions !== undefined && (
          <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
