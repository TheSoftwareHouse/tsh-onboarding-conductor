import type { ReactElement, ReactNode } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Typography } from '@/components/ui/Typography/Typography';
import { tv } from '@/lib/tv';
import { WORKFLOW_VIEWS, type WorkflowView } from '../../utils/workflow-details-search-params';

export interface VersionTabsProps {
  value: WorkflowView;
  onValueChange: (value: WorkflowView) => void;
  graph: ReactNode;
  json: ReactNode;
  /** PoC: the authored-graph canvas; editable on a draft, read-only on a stored version. */
  canvas?: ReactNode;
  /** Keeps the JSON panel in the DOM while hidden, so an editor's undo history and scroll survive. */
  keepJsonMounted?: boolean;
}

const tab = tv({
  base: 'mr-8 cursor-pointer border-b-2 py-4 last:mr-0',
  variants: {
    active: {
      true: 'border-tsh-black text-fg-1',
      false: 'border-transparent text-fg-3',
    },
  },
});

function isWorkflowView(value: unknown): value is WorkflowView {
  return WORKFLOW_VIEWS.some((view) => view === value);
}

/** The details page's Authored graph | Compiled graph | JSON switch, styled like `FilterTabs`. */
export function VersionTabs({
  value,
  onValueChange,
  graph,
  json,
  canvas,
  keepJsonMounted = false,
}: VersionTabsProps): ReactElement {
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => {
        if (isWorkflowView(next)) {
          onValueChange(next);
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <Tabs.List className="flex items-end border-b border-border-rule px-8">
        {canvas !== undefined && (
          <Tabs.Tab value="authored" className={tab({ active: value === 'authored' })}>
            <Typography variant="body-md" as="span">
              Authored graph
            </Typography>
          </Tabs.Tab>
        )}
        <Tabs.Tab value="compiled" className={tab({ active: value === 'compiled' })}>
          <Typography variant="body-md" as="span">
            Compiled graph
          </Typography>
        </Tabs.Tab>
        <Tabs.Tab value="json" className={tab({ active: value === 'json' })}>
          <Typography variant="body-md" as="span">
            JSON
          </Typography>
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="compiled" className="flex min-h-0 flex-1 flex-col">
        {graph}
      </Tabs.Panel>
      <Tabs.Panel
        value="json"
        keepMounted={keepJsonMounted}
        className="flex min-h-0 flex-1 flex-col data-hidden:hidden"
      >
        {json}
      </Tabs.Panel>
      {canvas !== undefined && (
        <Tabs.Panel value="authored" className="flex min-h-0 flex-1 flex-col">
          {canvas}
        </Tabs.Panel>
      )}
    </Tabs.Root>
  );
}
