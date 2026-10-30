import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { BaseEdge, EdgeLabelRenderer, useViewport, type EdgeProps } from '@xyflow/react';
import { cn } from '@/lib/cn';
import { buildEdgePath } from '../../utils/workflow-edge-path';
import type { WorkflowGraphEdge as WorkflowGraphEdgeModel } from '../../utils/workflow-graph-layout';

/** React Flow's documented classes for a label that takes pointer input without dragging or panning. */
const REACT_FLOW_INTERACTIVE = 'nodrag nopan';

/** Space kept between an expanded label and the canvas edge. */
const CANVAS_MARGIN = 8;

/** One edge, drawn along its route with rounded corners, its label on its own line. */
export function WorkflowGraphEdge({
  markerStart,
  markerEnd,
  style,
  data,
}: EdgeProps<WorkflowGraphEdgeModel>): ReactElement {
  const points = data?.points ?? [];
  const label = data?.label ?? '';
  const condition = data?.condition ?? label;
  const { zoom } = useViewport();
  const labelRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = hovered || focused;
  // Horizontal nudge, in flow units, that keeps an expanded label inside the canvas.
  const [shift, setShift] = useState(0);
  const anchor = data?.labelPosition ?? null;

  // Measured after the expanded styles commit, with no nudge applied, so hover and focus agree.
  useLayoutEffect(() => {
    const element = labelRef.current;
    const canvasElement = element?.closest('.react-flow');
    if (!expanded || element == null || canvasElement == null) {
      setShift(0);
      return;
    }

    const canvas = canvasElement.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    let next = 0;
    if (box.right > canvas.right - CANVAS_MARGIN) next = canvas.right - CANVAS_MARGIN - box.right;
    if (box.left + next < canvas.left + CANVAS_MARGIN)
      next = canvas.left + CANVAS_MARGIN - box.left;
    setShift(next / zoom);
    // Only on opening: a re-measure while open would read the box with the nudge already applied.
  }, [expanded]);

  return (
    <>
      <BaseEdge
        path={buildEdgePath(points)}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={style}
      />
      {label !== '' && anchor !== null && (
        // The label layer sits above the nodes, so the text is never hidden under one.
        <EdgeLabelRenderer>
          <div
            tabIndex={0}
            className={cn(
              REACT_FLOW_INTERACTIVE,
              'absolute border border-border-rule bg-bg-page px-1 font-mono text-body-2xs/natural',
              expanded
                ? 'z-10 max-w-[32ch] overflow-visible whitespace-normal'
                : 'z-0 max-w-[22ch] truncate whitespace-nowrap',
              data?.dashed ? 'text-fg-4' : 'text-fg-3',
            )}
            title={label}
            role="note"
            aria-label={label}
            ref={labelRef}
            data-expanded={expanded || undefined}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              // React Flow turns pointer events off on its label layer, which would swallow the hover.
              pointerEvents: 'all',
              transform: `translate(-50%, -50%) translate(${anchor.x + shift}px, ${anchor.y}px)`,
            }}
          >
            {condition}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
