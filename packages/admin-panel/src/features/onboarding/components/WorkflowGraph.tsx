import type { ReactElement } from 'react';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { describeAdminOnboardingStatus } from '../types/admin-onboarding';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  toEdgePath,
  type WorkflowGraph as WorkflowGraphModel,
  type WorkflowGraphNode,
} from '../utils/workflow-graph-layout';

/** Room for the arrowhead, so the marker is not clipped at the edge of the drawing. */
const EDGE_PADDING = 8;
/**
 * One arrowhead per state: an SVG marker cannot inherit the stroke of the path that uses it
 * without `context-stroke`, so each colour is declared as its own marker instead.
 */
const ARROW_MARKER_IDS: Record<WorkflowGraphNode['state'], string> = {
  completed: 'workflow-graph-arrow-completed',
  current: 'workflow-graph-arrow-current',
  failed: 'workflow-graph-arrow-failed',
  pending: 'workflow-graph-arrow-pending',
};

export interface WorkflowGraphProps {
  graph: WorkflowGraphModel;
}

const NODE_STATE_LABELS: Record<WorkflowGraphNode['state'], string> = {
  completed: 'Completed',
  current: 'Current step',
  failed: 'Failed',
  pending: 'Not taken',
};

/**
 * Says how far this onboarding got with the step, and when. The word is carried as text rather
 * than by colour alone, so the graph still reads without it.
 */
function describeNodeState(node: WorkflowGraphNode): string {
  const label = NODE_STATE_LABELS[node.state];

  return node.enteredAt === null ? label : `${label} · ${formatDateTime(node.enteredAt)}`;
}

/**
 * Draws the whole workflow — every step it declares and every transition between them — with the
 * path this onboarding walked picked out against the paths it did not.
 *
 * Edges are one SVG layer beneath absolutely positioned boxes, both placed from the same computed
 * geometry. That keeps the boxes as ordinary elements that inherit the panel's styling, while the
 * connectors are drawn where only a vector can draw them.
 */
export function WorkflowGraph({ graph }: WorkflowGraphProps): ReactElement {
  return (
    <div className="graph" style={{ width: graph.width + EDGE_PADDING * 2, height: graph.height }}>
      <svg
        className="graph__edges"
        width={graph.width + EDGE_PADDING * 2}
        height={graph.height}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          {Object.entries(ARROW_MARKER_IDS).map(([state, id]) => (
            <marker
              key={id}
              id={id}
              className={`graph__arrow graph__arrow--${state}`}
              markerWidth="8"
              markerHeight="8"
              refX="4"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 Z" />
            </marker>
          ))}
        </defs>
        {graph.edges.map((edge) => (
          <path
            key={edge.id}
            className={`graph__edge graph__edge--${edge.tone}`}
            d={toEdgePath(edge.points.map(([x, y]) => [x + EDGE_PADDING, y] as const))}
            markerEnd={`url(#${ARROW_MARKER_IDS[edge.tone]})`}
          />
        ))}
      </svg>
      <ul className="graph__nodes">
        {graph.nodes.map((node) => (
          <li
            key={node.name}
            className={`graph-node graph-node--${node.state}`}
            style={{
              left: node.x + EDGE_PADDING,
              top: node.y,
              width: NODE_WIDTH,
              minHeight: NODE_HEIGHT,
            }}
          >
            <p className="graph-node__name">{node.name}</p>
            <p className="graph-node__meta">{describeAdminOnboardingStatus(node.status)}</p>
            <p className="graph-node__meta">{describeNodeState(node)}</p>
            {node.selfTransitions.map((status) => (
              <p key={status} className="graph-node__meta">
                ↻ {status}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
