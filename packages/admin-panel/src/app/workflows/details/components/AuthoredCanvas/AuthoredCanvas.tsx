// PoC (throwaway): edit the authored draft document on a canvas. The editor text stays the only state.
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { listStepTypes } from '@tsh/ddl-schema/step-types/step-type.registry';
import { STEP_CATEGORIES } from '@tsh/ddl-schema/step-types/step-type.port';
import { Button } from '@/components/ui/Button/Button';
import { Chip } from '@/components/ui/Chip/Chip';
import { LeftPanelClose, LeftPanelOpen, Redo, Undo } from '@/components/ui/icons';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { Typography } from '@/components/ui/Typography/Typography';
import { JSON_INDENT } from '../../constants/json-indent';
import { describeStepKind } from '../../constants/step-kind-labels';
import { cn } from '@/lib/cn';
import { STEP_CATEGORY_TONES } from '../../constants/step-category-tones';
import {
  addInclude,
  addStep,
  clearPositions,
  listComposableTypes,
  removeInclude,
  connect,
  deleteStep,
  disconnect,
  findBackEdges,
  findRenameProblem,
  readArms,
  readTransitionIndex,
  readTransitions,
  listSections,
  parseDocument,
  projectDocument,
  renameStep,
  setSectionConfig,
  setArms,
  setInitial,
  setPosition,
  snapToGrid,
  GRID_SIZE,
  type AuthoredArm,
  type AuthoredDocument,
  type Json,
  type ProjectedStep,
} from './authored-graph';
import {
  AuthoredStepNodeView,
  BASE_NODE_HEIGHT,
  listPortCenters,
  MIN_NODE_WIDTH,
  nodeHeight,
  nodeWidth,
  type AuthoredStepNode,
} from './AuthoredStepNode';
import { InspectorBand } from './InspectorBand';
import { PanelClose } from './PanelClose';
import { PortArms } from './PortArms';
import { StepSections } from './StepSections';
import { WorkflowSettings } from './WorkflowSettings';
import { EDGE_OFFSET, routeEdges } from './edge-routing';
import { FIT_MAX_ZOOM, WorkflowZoomControls } from '../WorkflowGraph/WorkflowZoomControls';
import { ConditionEdge, type ConditionEdgeType } from './ConditionEdge';
import { layoutCanvas, NODE_GAP, RANK_GAP, type Positions } from './canvas-layout';
import { FIELD_NAMES_LIST_ID } from './SchemaForm/schema-utils';

export interface AuthoredCanvasProps {
  text: string;
  /** Left out, the canvas is read-only: no palette, no drag-to-wire, no inspector edits. */
  onChange?: (next: string) => void;
  /** The step the last Validate failed at, by name, so the mark survives edits that reorder steps. */
  errorStep?: string | null;
  /** The last Validate failure's path and reason, e.g. `steps[3].edges.success`. */
  errorPath: string | null;
  errorReason: string | null;
  /** The draft's undo stack; left out on a read-only canvas. */
  history?: {
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
  };
}

/** Where the palette's open or closed state is remembered, per browser. */
const PALETTE_STORAGE_KEY = 'tsh.canvas.paletteOpen';

function readPaletteOpen(): boolean {
  try {
    return window.localStorage.getItem(PALETTE_STORAGE_KEY) !== 'false';
  } catch {
    // Storage blocked (private mode, previews): the palette just opens.
    return true;
  }
}

function writePaletteOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, String(open));
  } catch {
    // Not remembered; the palette still toggles.
  }
}

/** Typing in a field keeps its own undo; the canvas shortcut only acts outside one. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

const NODE_TYPES: NodeTypes = { authoredStep: AuthoredStepNodeView };
const EDGE_TYPES: EdgeTypes = { condition: ConditionEdge };
const PLACE_GAP = 80;
/** How long the canvas takes to pan to a step added out of view. */
const PAN_DURATION_MS = 300;
/** Screen pixels a new step must sit inside the pane's edges, or the canvas pans to it. */
const PAN_MARGIN = 80;
/** Screen pixels between the top-left overlay and the start step after the canvas opens. */
const START_STEP_MARGIN = 24;
const EDGE_RADIUS = 8;
const BACK_EDGE_OFFSET = 28;
/** Edges into and out of the selected step. */
const HIGHLIGHT_COLOR = 'var(--color-tsh-blue-500)';
const HIGHLIGHT_STROKE_WIDTH = 2;
const NODE_SELECTOR = '.react-flow__node';

function readPosition(step: ProjectedStep): { x: number; y: number } | null {
  const position = step.step.meta?.position as { x?: unknown; y?: unknown } | undefined;
  // Snapped on read too, so a position saved before the grid existed still lines up.
  return typeof position?.x === 'number' && typeof position.y === 'number'
    ? snapToGrid({ x: position.x, y: position.y })
    : null;
}

export function AuthoredCanvas(props: AuthoredCanvasProps): ReactElement {
  return (
    <CanvasErrorBoundary text={props.text}>
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </CanvasErrorBoundary>
  );
}

interface CanvasErrorBoundaryProps {
  text: string;
  children: ReactNode;
}

interface CanvasErrorBoundaryState {
  error: Error | null;
  text: string;
}

/** A document the projection cannot read blanks only the canvas, and any edit to the text retries it. */
class CanvasErrorBoundary extends Component<CanvasErrorBoundaryProps, CanvasErrorBoundaryState> {
  state: CanvasErrorBoundaryState = { error: null, text: this.props.text };

  static getDerivedStateFromError(error: unknown): Partial<CanvasErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: CanvasErrorBoundaryProps,
    state: CanvasErrorBoundaryState,
  ): Partial<CanvasErrorBoundaryState> | null {
    return props.text === state.text ? null : { error: null, text: props.text };
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <StatusRegion className="px-8 py-6">
        {`The canvas cannot draw this document: ${this.state.error.message}. Fix it in the JSON tab.`}
      </StatusRegion>
    );
  }
}

function Canvas({
  text,
  onChange,
  errorStep = null,
  errorPath,
  errorReason,
  history,
}: AuthoredCanvasProps): ReactElement {
  const readOnly = onChange === undefined;
  const parsed = useMemo(() => parseDocument(text), [text]);
  const [selected, setSelected] = useState<string | null>(null);
  // Held here because the edges are derived: React Flow can only delete an edge it sees as selected.
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const { screenToFlowPosition, fitView, getNode, getNodes, getViewport, setViewport, setCenter } =
    useReactFlow();
  // The top-left overlay (counts, problems, settings): the start step is kept clear of it on open.
  const overlayRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const nodesInitialized = useNodesInitialized();
  const [fitted, setFitted] = useState(false);
  // The palette type being dragged, and the step it would be included into if dropped now.
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const doc = typeof parsed === 'string' ? null : parsed;
  const projection = useMemo(() => (doc ? projectDocument(doc) : null), [doc]);
  const [paletteOpen, setPaletteOpen] = useState(readPaletteOpen);
  const togglePalette = (): void => {
    writePaletteOpen(!paletteOpen);
    setPaletteOpen(!paletteOpen);
  };

  // ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Y redoes, while the canvas tab is open and no field has focus.
  useEffect(() => {
    if (history === undefined) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) history.onUndo();
      else if ((key === 'z' && event.shiftKey) || key === 'y') history.onRedo();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [history]);

  const backEdges = useMemo(
    () => (projection ? findBackEdges(projection.steps, projection.edges) : new Set<string>()),
    [projection],
  );

  // Laid out once on open and on "Re-layout"; after that a node only moves when dragged. A step the
  // map has not seen yet is placed under the port that first wires into it, then pinned there.
  const [positions, setPositions] = useState<Positions | null>(null);

  const runLayout = useCallback(() => {
    if (!projection) return;
    setPositions(layoutCanvas(projection.steps, projection.edges, backEdges));
    setFitted(false);
  }, [projection, backEdges]);

  useEffect(() => {
    if (positions === null) runLayout();
  }, [positions, runLayout]);

  const placed = useMemo<Positions | null>(() => {
    if (!projection || positions === null) return null;
    const result: Positions = new Map(positions);
    const byName = new Map(projection.steps.map((step) => [step.step.name, step]));
    let fallbackX = Math.max(0, ...[...result.values()].map((position) => position.x)) + PLACE_GAP;
    const boxes = projection.steps.flatMap((step) => {
      const position = readPosition(step) ?? result.get(step.step.name);
      return position ? [{ ...position, width: nodeWidth(step), height: nodeHeight(step) }] : [];
    });
    // Shifted right until it clears every step already on the canvas.
    const findFreeSpot = (
      wanted: { x: number; y: number },
      width: number,
      height: number,
    ): { x: number; y: number } => {
      const spot = { ...wanted };
      const overlaps = (box: (typeof boxes)[number]): boolean =>
        spot.x < box.x + box.width + NODE_GAP &&
        box.x < spot.x + width + NODE_GAP &&
        spot.y < box.y + box.height + NODE_GAP &&
        box.y < spot.y + height + NODE_GAP;
      let blocker = boxes.find(overlaps);
      while (blocker) {
        spot.x = blocker.x + blocker.width + NODE_GAP;
        blocker = boxes.find(overlaps);
      }
      const snapped = snapToGrid(spot);
      boxes.push({ ...snapped, width, height });
      return snapped;
    };
    for (const step of projection.steps) {
      const name = step.step.name;
      if (readPosition(step) ?? result.get(name)) continue;
      const incoming = projection.edges.find(
        (edge) =>
          edge.target === name &&
          (result.has(edge.source) || readPosition(byName.get(edge.source)!)),
      );
      const source = incoming ? byName.get(incoming.source) : undefined;
      const origin = source ? (readPosition(source) ?? result.get(source.step.name)) : undefined;
      if (incoming && source && origin) {
        const port = listPortCenters(source).find((center) => center.name === incoming.handle);
        result.set(
          name,
          findFreeSpot(
            {
              x: origin.x + (port?.x ?? 0) - nodeWidth(step) / 2,
              y: origin.y + nodeHeight(source) + RANK_GAP,
            },
            nodeWidth(step),
            nodeHeight(step),
          ),
        );
      } else {
        result.set(name, findFreeSpot({ x: fallbackX, y: 0 }, nodeWidth(step), nodeHeight(step)));
        fallbackX += nodeWidth(step) + NODE_GAP;
      }
    }
    return result;
  }, [projection, positions]);

  // Pin what was just placed, so wiring something else later never moves it.
  useEffect(() => {
    if (placed !== null && positions !== null && placed.size > positions.size) setPositions(placed);
  }, [placed, positions]);

  const derivedNodes = useMemo<AuthoredStepNode[]>(() => {
    if (!projection || placed === null) return [];
    return projection.steps.map((step) => ({
      id: step.step.name,
      type: 'authoredStep',
      position: readPosition(step) ?? placed.get(step.step.name) ?? { x: 0, y: 0 },
      data: {
        ...step,
        hasError: step.step.name === errorStep,
        readOnly,
        isDropTarget: step.step.name === dropTarget,
      },
      selected: step.step.name === selected,
    }));
  }, [projection, placed, errorStep, selected, readOnly, dropTarget]);

  const [nodes, setNodes, onNodesChange] = useNodesState<AuthoredStepNode>(derivedNodes);
  // Keeps each node's measured size: a fresh node object is unmeasured, and React Flow hides it until
  // it measures again, so rebuilding on every hover or selection made the whole canvas blink out.
  useEffect(
    () =>
      setNodes((current) => {
        const measured = new Map(current.map((node) => [node.id, node.measured]));
        return derivedNodes.map((node) => ({ ...node, measured: measured.get(node.id) }));
      }),
    [derivedNodes, setNodes],
  );

  // Fit, then, when the zoom floor crops the top, pan down until the start step sits below the overlay.
  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0 || fitted) return;
    setFitted(true);
    void fitView({ padding: 0.05, minZoom: 0.6, maxZoom: FIT_MAX_ZOOM }).then(() => {
      const start = getNodes().find((node) => node.data.isInitial);
      if (start === undefined) return;
      const { x, y, zoom } = getViewport();
      const top = start.position.y * zoom + y;
      const clearance = (overlayRef.current?.offsetHeight ?? 0) + START_STEP_MARGIN;
      if (top < clearance) void setViewport({ x, y: y + clearance - top, zoom });
    });
  }, [nodesInitialized, nodes.length, fitted, fitView, getNodes, getViewport, setViewport]);

  // Routed from the live nodes, so edges follow a step while it is dragged.
  const routes = useMemo(
    () => routeEdges(nodes, projection?.edges ?? [], backEdges),
    [nodes, projection, backEdges],
  );

  // A back edge (retry loops) climbs a lane right of the graph and is dashed, so it reads as "go back" and stays out of the forward flow.
  const edges = useMemo<ConditionEdgeType[]>(() => {
    // Labels hang under their port; arms of one port stack, so count them per port.
    const stacked = new Map<string, number>();
    return (projection?.edges ?? [])
      .filter((edge) => !edge.dangling)
      .map((edge) => {
        const isBack = backEdges.has(edge.id);
        const highlighted =
          edge.id === selectedEdge ||
          (selected !== null && (edge.source === selected || edge.target === selected));
        // A loop back keeps its condition on the port's tooltip, so its label does not cross the graph.
        const condition = isBack ? '' : edge.condition;
        const key = `${edge.source}:${edge.handle}`;
        const stackIndex = stacked.get(key) ?? 0;
        if (condition !== '') stacked.set(key, stackIndex + 1);
        return {
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.handle,
          target: edge.target,
          targetHandle: null,
          type: 'condition',
          selected: edge.id === selectedEdge,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            ...(highlighted ? { color: HIGHLIGHT_COLOR } : {}),
          },
          // Drawn above the rest, so a highlighted edge is never hidden under another.
          zIndex: highlighted ? 1 : 0,
          data: {
            highlighted,
            port: edge.port,
            armIndex: edge.armIndex,
            condition,
            stackIndex,
            borderRadius: EDGE_RADIUS,
            offset: isBack ? BACK_EDGE_OFFSET : EDGE_OFFSET,
            route: routes.get(edge.id) ?? null,
          },
          style: {
            ...(isBack
              ? { strokeWidth: 1.25, strokeDasharray: '5 4', stroke: 'var(--color-fg-4)' }
              : { strokeWidth: 1.5 }),
            ...(highlighted
              ? { stroke: HIGHLIGHT_COLOR, strokeWidth: HIGHLIGHT_STROKE_WIDTH }
              : {}),
          },
        };
      });
  }, [projection, backEdges, selected, selectedEdge, routes]);

  const write = useCallback(
    (next: AuthoredDocument) => onChange?.(JSON.stringify(next, null, JSON_INDENT)),
    [onChange],
  );

  if (!doc || !projection) {
    return (
      <StatusRegion className="px-8 py-6">{`Canvas needs valid JSON: ${String(parsed)}`}</StatusRegion>
    );
  }

  const selectedStep = projection.steps.find((step) => step.step.name === selected) ?? null;
  const unwiredTotal = projection.steps.reduce(
    (sum, step) =>
      sum +
      step.unwired.filter((port) =>
        step.ports.kind === 'known'
          ? !step.ports.ports.find((candidate) => candidate.name === port)?.optional
          : false,
      ).length +
      step.unfinished.length,
    0,
  );
  const dangling = projection.edges.filter((edge) => edge.dangling);
  const withIssues = projection.steps.filter((step) => step.issues.length > 0);
  const unreachable = projection.steps.filter((step) =>
    step.issues.some((issue) => issue.startsWith('unreachable')),
  ).length;

  function handleConnect(connection: Connection): void {
    if (!doc || !connection.sourceHandle) return;
    write(connect(doc, connection.source, connection.sourceHandle, connection.target));
  }

  /** A step already covering where a new one would land at `spot`. */
  function findBlocker(spot: { x: number; y: number }): Node | undefined {
    return getNodes().find(
      ({ position, measured }) =>
        spot.x < position.x + (measured?.width ?? 0) &&
        spot.x + MIN_NODE_WIDTH > position.x &&
        spot.y < position.y + (measured?.height ?? 0) &&
        spot.y + BASE_NODE_HEIGHT > position.y,
    );
  }

  // Under the selected step (so repeated clicks build a column), else mid-pane; moved below any step
  // already there, then panned into view so the new step is never added off-screen.
  function handleAdd(type: string): void {
    const pane = paneRef.current?.getBoundingClientRect();
    if (!doc || !pane) return;
    const anchor = selected === null ? undefined : getNode(selected);
    const center = screenToFlowPosition({
      x: pane.left + pane.width / 2,
      y: pane.top + pane.height / 2,
    });
    let spot = anchor
      ? { x: anchor.position.x, y: anchor.position.y + (anchor.measured?.height ?? 0) + RANK_GAP }
      : { x: center.x - MIN_NODE_WIDTH / 2, y: center.y - BASE_NODE_HEIGHT / 2 };
    for (let blocker = findBlocker(spot); blocker; blocker = findBlocker(spot)) {
      spot = { x: spot.x, y: blocker.position.y + (blocker.measured?.height ?? 0) + NODE_GAP };
    }
    const { doc: next, name } = addStep(doc, type, spot);
    write(next);
    setSelected(name);
    setSelectedEdge(null);

    const { x, y, zoom } = getViewport();
    const left = spot.x * zoom + x;
    const top = spot.y * zoom + y;
    // A margin, because the new card is taller than the base height once its warnings show.
    const visible =
      left >= PAN_MARGIN &&
      top >= PAN_MARGIN &&
      left + MIN_NODE_WIDTH * zoom <= pane.width - PAN_MARGIN &&
      top + BASE_NODE_HEIGHT * zoom <= pane.height - PAN_MARGIN;
    if (!visible) {
      void setCenter(spot.x + MIN_NODE_WIDTH / 2, spot.y + BASE_NODE_HEIGHT / 2, {
        zoom,
        duration: PAN_DURATION_MS,
      });
    }
  }

  const composable = listComposableTypes();

  /** The step under the pointer, when the dragged type can be included into it. */
  function findDropTarget(event: DragEvent): string | null {
    if (dragged === null || !composable.includes(dragged)) return null;
    const node = (event.target as Element).closest(NODE_SELECTOR);
    return node?.getAttribute('data-id') ?? null;
  }

  function handleDragOver(event: DragEvent): void {
    if (dragged === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const target = findDropTarget(event);
    if (target !== dropTarget) setDropTarget(target);
  }

  // Onto a step: a composable type becomes one of its sections. Anywhere else: a new step there.
  function handleDrop(event: DragEvent): void {
    if (!doc || dragged === null) return;
    event.preventDefault();
    const target = findDropTarget(event);
    if (target !== null) {
      write(addInclude(doc, target, dragged));
      setSelected(target);
    } else {
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const { doc: next, name } = addStep(doc, dragged, position);
      write(next);
      setSelected(name);
    }
    setDragged(null);
    setDropTarget(null);
  }

  const stepTypes = listStepTypes();
  // Every field the workflow collects, offered wherever an input names a field.
  const fieldNames = [
    ...new Set(
      projection.steps.flatMap((step) =>
        listSections(step.step).flatMap((section) =>
          Array.isArray(section.fields) ? section.fields.map((field) => field.name) : [],
        ),
      ),
    ),
  ];

  return (
    <div className="flex min-h-0 flex-1">
      <datalist id={FIELD_NAMES_LIST_ID}>
        {fieldNames.map((field) => (
          <option key={field} value={field} />
        ))}
      </datalist>
      {/* Palette: every registered step type, grouped by category. */}
      {!readOnly && !paletteOpen && (
        <aside className="flex shrink-0 flex-col items-center border-r border-border-rule py-3">
          <button
            type="button"
            aria-label="Show step palette"
            title="Show step palette"
            className="cursor-pointer px-2 text-fg-3 hover:text-fg-1"
            onClick={togglePalette}
          >
            <LeftPanelOpen aria-hidden className="size-6" />
          </button>
        </aside>
      )}
      {!readOnly && paletteOpen && (
        <aside className="flex w-52 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border-rule p-3">
          <div className="flex items-center justify-between gap-2">
            <Typography variant="caps-tiny">Add step</Typography>
            <button
              type="button"
              aria-label="Hide step palette"
              title="Hide step palette"
              className="cursor-pointer text-fg-3 hover:text-fg-1"
              onClick={togglePalette}
            >
              <LeftPanelClose aria-hidden className="size-6" />
            </button>
          </div>
          {STEP_CATEGORIES.map((category) => (
            // One bar down the whole category, heading included, flush with the palette's left edge.
            <div
              key={category}
              className={cn(
                '-ml-3 flex flex-col border-l-8',
                STEP_CATEGORY_TONES[category]?.accent,
              )}
            >
              <Typography variant="meta" className="px-3 pb-1">
                {category}
              </Typography>
              {stepTypes
                .filter((type) => type.category === category)
                .map((type) => (
                  <Button
                    key={type.type}
                    variant="quiet"
                    size="sm"
                    className="justify-between"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', type.type);
                      event.dataTransfer.effectAllowed = 'copy';
                      setDragged(type.type);
                    }}
                    onDragEnd={() => {
                      setDragged(null);
                      setDropTarget(null);
                    }}
                    onClick={() => handleAdd(type.type)}
                  >
                    {type.type}
                    {type.composable && (
                      <Typography
                        variant="meta"
                        as="span"
                        className="border border-border-strong px-1 text-fg-3"
                        title="Can also be dropped onto a step, to include it as a section"
                      >
                        section
                      </Typography>
                    )}
                  </Button>
                ))}
            </div>
          ))}
          <Typography variant="meta">
            Click or drag onto the canvas to add a step. Drop a type tagged section onto a step to
            include it there. Click an edge and press Delete to remove it.
          </Typography>
        </aside>
      )}

      <div
        ref={paneRef}
        className="relative min-h-0 flex-1"
        onDragOver={readOnly ? undefined : handleDragOver}
        onDrop={readOnly ? undefined : handleDrop}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          edgesReconnectable={false}
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          // Every node of a multi-selection moved, not just the one under the pointer.
          onNodeDragStop={(_, __, dragged) =>
            write(dragged.reduce((next, node) => setPosition(next, node.id, node.position), doc))
          }
          onConnect={handleConnect}
          // One write for the whole deletion: separate edge and node handlers would each start from `doc` and the later one would win.
          onDelete={({ nodes: removedNodes, edges: removedEdges }) => {
            let next = doc;
            for (const edge of removedEdges) {
              const data = edge.data as { port: string; armIndex: number | null };
              next = disconnect(next, edge.source, data.port, data.armIndex);
            }
            write(removedNodes.reduce((current, node) => deleteStep(current, node.id), next));
            if (removedNodes.length > 0) setSelected(null);
            setSelectedEdge(null);
          }}
          onNodeClick={(_, node) => {
            setSelected(node.id);
            setSelectedEdge(null);
            setShowSettings(false);
          }}
          onEdgeClick={
            readOnly
              ? undefined
              : (_, edge) => {
                  setSelectedEdge(edge.id);
                  setSelected(null);
                  setShowSettings(false);
                }
          }
          onPaneClick={() => {
            setSelected(null);
            setSelectedEdge(null);
            setShowSettings(false);
          }}
          snapToGrid
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          minZoom={0.1}
        >
          <Panel position="top-right">
            <WorkflowZoomControls />
          </Panel>
          <Panel
            ref={overlayRef}
            position="top-left"
            className="flex flex-col gap-1 bg-tsh-white/90 p-2"
          >
            <Typography variant="meta">
              {projection.steps.length} steps · {projection.edges.length} edges
            </Typography>
            {withIssues.length > 0 ? (
              <Typography variant="meta" className="text-tsh-red">
                ⚠ {withIssues.length} step{withIssues.length === 1 ? '' : 's'} with problems
                {unreachable > 0 ? ` · ${unreachable} unreachable` : ''}
                {unwiredTotal > 0 ? ` · ${unwiredTotal} required ports unwired` : ''}
                {dangling.length > 0 ? ` · ${dangling.length} edges to missing steps` : ''}
              </Typography>
            ) : (
              <Typography variant="meta">No problems found on the canvas</Typography>
            )}
            {errorReason && (
              <Typography variant="meta" className="text-tsh-red">
                Last Validate: {errorReason}
                {errorStep ? ` at ${errorStep}` : errorPath ? ` at ${errorPath}` : ''}
              </Typography>
            )}
            <div className="flex gap-2">
              {history && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Undo"
                    title="Undo (⌘Z / Ctrl+Z)"
                    disabled={!history.canUndo}
                    onClick={history.onUndo}
                  >
                    <Undo aria-hidden className="size-5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Redo"
                    title="Redo (⇧⌘Z / Ctrl+Y)"
                    disabled={!history.canRedo}
                    onClick={history.onRedo}
                  >
                    <Redo aria-hidden className="size-5" />
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelected(null);
                  setShowSettings(true);
                }}
              >
                Workflow settings
              </Button>
              {!readOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    write(clearPositions(doc));
                    runLayout();
                  }}
                >
                  Re-layout (drop saved positions)
                </Button>
              )}
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {showSettings && selectedStep === null && (
        <WorkflowSettings
          doc={doc}
          stepNames={projection.steps.map((step) => step.step.name)}
          readOnly={readOnly}
          onChange={write}
          onClose={() => setShowSettings(false)}
        />
      )}
      {selectedStep && (
        <StepPanel
          key={selectedStep.step.name}
          step={selectedStep}
          readOnly={readOnly}
          stepNames={projection.steps.map((step) => step.step.name)}
          findNameProblem={(to) => findRenameProblem(doc, selectedStep.step.name, to)}
          onRename={(to) => {
            setPositions((current) => {
              const position = current?.get(selectedStep.step.name);
              if (!current || !position) return current;
              const next = new Map(current);
              next.set(to, position);
              return next;
            });
            write(renameStep(doc, selectedStep.step.name, to));
            setSelected(to);
          }}
          onArms={(port, arms) => write(setArms(doc, selectedStep.step.name, port, arms))}
          onWire={(port, target) =>
            write(
              target === ''
                ? disconnect(doc, selectedStep.step.name, port, null)
                : connect(doc, selectedStep.step.name, port, target),
            )
          }
          onConfig={(include, config) =>
            write(setSectionConfig(doc, selectedStep.step.name, include, config))
          }
          onAddSection={(type) => write(addInclude(doc, selectedStep.step.name, type))}
          onRemoveSection={(include) => write(removeInclude(doc, selectedStep.step.name, include))}
          onInitial={() => write(setInitial(doc, selectedStep.step.name))}
          onClose={() => setSelected(null)}
          onDelete={() => {
            write(deleteStep(doc, selectedStep.step.name));
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

interface StepPanelProps {
  step: ProjectedStep;
  readOnly: boolean;
  stepNames: string[];
  findNameProblem: (to: string) => string | null;
  onRename: (to: string) => void;
  onWire: (port: string, target: string) => void;
  onArms: (port: string, arms: AuthoredArm[]) => void;
  onConfig: (include: number | null, config: Json) => void;
  onAddSection: (type: string) => void;
  onRemoveSection: (include: number) => void;
  onInitial: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function StepPanel({
  step,
  readOnly,
  stepNames,
  findNameProblem,
  onRename,
  onWire,
  onArms,
  onConfig,
  onAddSection,
  onRemoveSection,
  onInitial,
  onDelete,
  onClose,
}: StepPanelProps): ReactElement {
  const [name, setName] = useState(step.step.name);
  const problem = name === step.step.name ? null : findNameProblem(name);
  const knownPorts = step.ports.kind === 'known' ? step.ports.ports : [];
  const portNames = knownPorts.map((port) => port.name);
  const transitions = readTransitions(step.step);
  const wiredOnly = Object.keys(step.step.edges ?? {}).filter((port) => !portNames.includes(port));

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border-rule xl:w-md 2xl:w-lg">
      <header className="flex flex-col gap-2 border-b border-border-hair px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <Typography variant="caps-tiny" as="span" className="text-fg-4">
            Selected step
          </Typography>
          <span className="flex items-center gap-3">
            <Chip tone="neutral-strong" className="px-2.5 font-medium" title={step.step.type}>
              {describeStepKind(step.step.type)}
            </Chip>
            <PanelClose onClose={onClose} />
          </span>
        </div>
        <input
          className="border border-border-strong px-2 py-1 font-mono text-body-md"
          value={name}
          readOnly={readOnly}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name !== step.step.name && problem === null && onRename(name)}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
          aria-label="Step name"
          aria-invalid={problem !== null}
          aria-describedby={problem !== null ? 'step-name-error' : undefined}
        />
        {problem !== null && (
          <Typography id="step-name-error" variant="meta" className="text-tsh-red">
            {problem}
          </Typography>
        )}
        <div className={readOnly ? 'hidden' : 'flex gap-2'}>
          <Button variant="outline" size="sm" disabled={step.isInitial} onClick={onInitial}>
            {step.isInitial ? 'Initial step' : 'Set as initial'}
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete}>
            Delete step
          </Button>
        </div>
      </header>

      <InspectorBand
        title="Ports"
        meta={`${portNames.length + wiredOnly.length} ${portNames.length + wiredOnly.length === 1 ? 'port' : 'ports'}`}
      >
        {step.ports.kind === 'config-error' && (
          <Typography variant="meta" className="text-tsh-red">
            {step.ports.message}
          </Typography>
        )}
        {[...portNames, ...wiredOnly].map((port) => {
          const transitionIndex = readTransitionIndex(port);
          const info = knownPorts.find((candidate) => candidate.name === port);
          const label = (
            <Typography
              variant="mono"
              as="span"
              className={wiredOnly.includes(port) ? 'text-tsh-red line-through' : ''}
              title={info?.detail}
            >
              {info?.label ?? port}
              {info?.detail ? (
                <Typography variant="meta" as="span" className="block">
                  {info.detail}
                </Typography>
              ) : null}
            </Typography>
          );
          // A custom step's transition carries its own condition in config; its port only picks a target.
          if (transitionIndex !== null) {
            return (
              <label key={port} className="flex items-center justify-between gap-2">
                {label}
                <select
                  disabled={readOnly}
                  className="border border-border-strong px-1 py-0.5 text-body-sm"
                  value={transitions[transitionIndex]?.target ?? ''}
                  onChange={(event) => onWire(port, event.target.value)}
                >
                  <option value="">— unwired —</option>
                  {stepNames.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <PortArms
              key={port}
              label={label}
              arms={readArms(step.step, port)}
              stepNames={stepNames}
              readOnly={readOnly}
              onChange={(arms) => onArms(port, arms)}
            />
          );
        })}
      </InspectorBand>

      <StepSections
        step={step.step}
        readOnly={readOnly}
        onConfig={onConfig}
        onAddSection={onAddSection}
        onRemoveSection={onRemoveSection}
      />
    </aside>
  );
}

export interface VersionCanvasProps {
  workflowId: string;
  version: number;
}

/** PoC: a stored (published or retired) version's authored document on the canvas, read-only. */
export function VersionCanvas({ workflowId, version }: VersionCanvasProps): ReactElement {
  const { data: stored, error } = useQuery(workflowQueries.document(workflowId, version));
  if (error !== null) {
    return (
      <StatusRegion className="px-8 py-6">{`Unable to load the document: ${error.message}`}</StatusRegion>
    );
  }
  if (stored === undefined) {
    return <StatusRegion className="px-8 py-6">Loading document…</StatusRegion>;
  }
  return (
    <AuthoredCanvas
      text={JSON.stringify(stored.document, null, JSON_INDENT)}
      errorPath={null}
      errorReason={null}
    />
  );
}
