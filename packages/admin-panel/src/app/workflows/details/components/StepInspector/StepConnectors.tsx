import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import type { ConnectorSelectionTarget } from '@/api/workflows/workflow-connector-selection';
import type {
  WorkflowStepConnector,
  WorkflowStepConnectorWithFallbacks,
} from '@/api/workflows/workflow-definitions';
import { Button } from '@/components/ui/Button/Button';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { Typography } from '@/components/ui/Typography/Typography';
import { ADMIN_ROUTES } from '@/constants/routes';
import { useConnectorSelection } from '../../hooks/useConnectorSelection';
import { describeConnectorSelectionError } from '../../utils/describe-connector-selection-error';

export interface StepConnectorsProps {
  workflowId: string;
  stepName: string;
  version: number;
  connectors: WorkflowStepConnectorWithFallbacks[];
  /** True on a draft or a retired version, where no selection is offered. */
  readOnly?: boolean;
}

function describeFlags(connector: WorkflowStepConnector): string {
  return [
    connector.type,
    `order ${connector.order}`,
    connector.async ? 'async' : null,
    connector.canReject ? 'canReject' : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

function BlockLabel({ children }: { children: string }): ReactElement {
  return (
    <Typography
      variant="meta"
      as="span"
      className="text-body-2xs font-medium tracking-caps text-tsh-gray-400 uppercase"
    >
      {children}
    </Typography>
  );
}

function MappingRows({ connector }: { connector: WorkflowStepConnector }): ReactElement | null {
  const rows = [
    ...Object.entries(connector.fieldMapping).map(([key, value]) => ({
      key,
      value,
      optional: false,
    })),
    ...Object.entries(connector.optionalFieldMapping).map(([key, value]) => ({
      key,
      value,
      optional: true,
    })),
  ];
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <BlockLabel>Field mapping</BlockLabel>
      {rows.map((row) => (
        <div
          key={`${row.optional}-${row.key}`}
          className="flex items-baseline justify-between gap-3"
        >
          {/* The arrow is glued to the connector field, so a long row wraps only after it. */}
          <span className="min-w-0 pl-4 -indent-4 font-mono text-caps-tiny font-normal tracking-normal text-tsh-black">
            <span className="whitespace-nowrap">
              {row.key}
              {'\u00a0'}
              <span className="text-fg-4">→</span>
            </span>{' '}
            <span className="whitespace-nowrap">{row.value}</span>
          </span>
          {row.optional && (
            <span className="shrink-0 text-body-2xs font-medium tracking-caps text-tsh-gray-400 uppercase">
              Optional
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface ConnectorCardProps {
  workflowId: string;
  stepName: string;
  version: number;
  connector: WorkflowStepConnectorWithFallbacks;
  readOnly: boolean;
}

function ConnectorCard({
  workflowId,
  stepName,
  version,
  connector,
  readOnly,
}: ConnectorCardProps): ReactElement {
  const { select, clear, isPending } = useConnectorSelection(workflowId);
  const [chosenId, setChosenId] = useState(connector.id);
  const coveredVersions = connector.versions.map((entry) => `v${entry.version}`).join(', ');
  const spansVersions = connector.versions.length >= 2;

  async function handleSelect(target: ConnectorSelectionTarget): Promise<void> {
    const outcome = await select(stepName, chosenId, target);
    if (outcome.ok) {
      showSuccessToast(
        `Connector set to ${chosenId} on ${target.scope === 'all' ? coveredVersions : `v${version}`}`,
      );
    } else {
      showErrorToast('Unable to change connector', describeConnectorSelectionError(outcome.error));
    }
  }

  async function handleClear(target: ConnectorSelectionTarget): Promise<void> {
    const outcome = await clear(stepName, target);
    if (outcome.ok) {
      showSuccessToast(
        `Authored connector restored on ${target.scope === 'all' ? 'every version' : `v${version}`}`,
      );
    } else {
      showErrorToast('Unable to change connector', describeConnectorSelectionError(outcome.error));
    }
  }

  return (
    <div className="flex flex-col gap-3 border border-border-hair p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-mono text-tsh-black">{connector.name}</span>
        <span className="text-right text-body-2xs tracking-caps text-fg-4 uppercase">
          {describeFlags(connector)}
        </span>
      </div>
      {!readOnly && connector.selectableIds.length > 1 && (
        <div className="flex flex-col gap-2">
          <select
            aria-label={`Connector for ${stepName}`}
            value={chosenId}
            disabled={isPending}
            onChange={(event) => setChosenId(event.target.value)}
            className="h-10 min-w-0 border border-border-strong bg-tsh-white px-3 font-mono text-mono text-tsh-black"
          >
            {connector.selectableIds.map((id) => (
              <option key={id} value={id}>
                {id === connector.authoredId ? `${id} (authored)` : id}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={isPending || chosenId === connector.id}
              onClick={() => void handleSelect({ scope: 'version', version })}
            >
              Save for v{version}
            </Button>
            {spansVersions && (
              <Button
                variant="outline"
                size="sm"
                disabled={isPending || connector.versions.every((entry) => entry.id === chosenId)}
                onClick={() => void handleSelect({ scope: 'all' })}
              >
                Apply to all published versions
              </Button>
            )}
            {connector.selected && (
              <Button
                variant="quiet"
                size="sm"
                disabled={isPending}
                onClick={() => void handleClear({ scope: 'version', version })}
              >
                Restore on v{version}
              </Button>
            )}
            {spansVersions && connector.versions.some((entry) => entry.selected) && (
              <Button
                variant="quiet"
                size="sm"
                disabled={isPending}
                onClick={() => void handleClear({ scope: 'all' })}
              >
                Restore on all versions
              </Button>
            )}
          </div>
          <Typography
            variant="meta"
            className="leading-natural font-normal tracking-normal text-pretty"
          >
            Saves for this version, or for every published version with this step. Drafts and newly
            published versions run their authored connector. Onboardings already waiting on the
            previous connector finish with it.
          </Typography>
        </div>
      )}
      <MappingRows connector={connector} />
      {connector.fallbacks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <BlockLabel>Fallbacks</BlockLabel>
          {connector.fallbacks.map((fallback) => (
            <div
              key={`${fallback.order}-${fallback.id}`}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="shrink-0 font-mono text-caps-tiny font-normal tracking-normal whitespace-nowrap text-tsh-black">
                {fallback.name}
              </span>
              <span
                title={describeFlags(fallback)}
                className="min-w-0 truncate text-body-2xs tracking-caps text-fg-4 uppercase"
              >
                {describeFlags(fallback)}
              </span>
            </div>
          ))}
        </div>
      )}
      <Link to={ADMIN_ROUTES.connectors.root} className="text-mono text-tsh-black no-underline">
        → Global settings for {connector.id}
      </Link>
    </div>
  );
}

/** One card per declared connector, in order: identity, the runtime selection, field mapping, fallbacks and the global link. */
export function StepConnectors({
  workflowId,
  stepName,
  version,
  connectors,
  readOnly = false,
}: StepConnectorsProps): ReactElement {
  return (
    <section className="flex flex-col gap-3.5 border-b border-border-hair px-6 py-5">
      <Typography variant="caps-tiny" as="h3" className="text-fg-3">
        Connector
      </Typography>
      {connectors.map((connector) => (
        <ConnectorCard
          key={`${stepName}-${connector.order}-${connector.id}`}
          workflowId={workflowId}
          stepName={stepName}
          version={version}
          connector={connector}
          readOnly={readOnly}
        />
      ))}
      <Typography
        variant="meta"
        className="leading-natural font-normal tracking-normal text-pretty"
      >
        Credentials always come from the global connector; a workflow may override non-secret config
        only.
      </Typography>
    </section>
  );
}
