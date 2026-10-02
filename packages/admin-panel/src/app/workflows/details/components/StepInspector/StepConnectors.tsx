import type { ReactElement } from 'react';
import { Link } from 'react-router';
import type {
  WorkflowStepConnector,
  WorkflowStepConnectorWithFallbacks,
} from '@/api/workflows/workflow-definitions';
import { Typography } from '@/components/ui/Typography/Typography';
import { ADMIN_ROUTES } from '@/constants/routes';

export interface StepConnectorsProps {
  connectors: WorkflowStepConnectorWithFallbacks[];
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

/** One card per declared connector, in order: identity, field mapping, fallbacks and the global link. */
export function StepConnectors({ connectors }: StepConnectorsProps): ReactElement {
  return (
    <section className="flex flex-col gap-3.5 border-b border-border-hair px-6 py-5">
      <Typography variant="caps-tiny" as="h3" className="text-fg-3">
        Connector
      </Typography>
      {connectors.map((connector) => (
        <div
          key={`${connector.order}-${connector.id}`}
          className="flex flex-col gap-3 border border-border-hair p-3.5"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-mono text-tsh-black">{connector.name}</span>
            <span className="text-right text-body-2xs tracking-caps text-fg-4 uppercase">
              {describeFlags(connector)}
            </span>
          </div>
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
