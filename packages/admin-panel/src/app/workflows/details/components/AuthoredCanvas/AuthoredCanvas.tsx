import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import { Typography } from '@/components/ui/Typography/Typography';
import { MIN_ZOOM } from '../../constants/graph-zoom';
import type { AuthoredDocument } from '../../utils/authored-document';
import {
  connect,
  deleteStep,
  disconnect,
  GRID_SIZE,
  hasPositions,
  pinPositions,
  setPositions,
} from '../../utils/authored-edits';
import { listBackEdges, projectDocument } from '../../utils/authored-projection';
import { routeEdges } from '../../utils/edge-routing';
import { readStepPosition } from '../../utils/step-placement';
import { AuthoredStepNode, type AuthoredStepNodeType } from './AuthoredStepNode/AuthoredStepNode';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import { CanvasPalette } from './CanvasPalette/CanvasPalette';
import { CanvasStatus, type CanvasFailure } from './CanvasStatus';
import { CanvasToolbar } from './CanvasToolbar';
import { ConditionEdge, type ConditionEdgeType } from './ConditionEdge';
import { StepPanel } from './StepPanel/StepPanel';
import { useCanvasEdges } from './useCanvasEdges';
import { useCanvasPlacement } from './useCanvasPlacement';
import { useCanvasViewport } from './useCanvasViewport';
import { useStepInsertion } from './useStepInsertion';
import { WorkflowContentsContext } from './workflow-contents';
import { WorkflowSettings } from './WorkflowSettings/WorkflowSettings';

export interface AuthoredCanvasProps {
  doc: AuthoredDocument;
  /** No palette, no drag-to-wire, no deleting, and the inspectors cannot edit. */
  readOnly: boolean;
  /** The last Validate failure, marked on the step it names. */
  failure?: CanvasFailure | null;
  /** Every edit hands over the whole next document. */
  onChange?: (doc: AuthoredDocument) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

type Selection =
  | { kind: 'none' }
  | { kind: 'step'; name: string }
  | { kind: 'edge'; id: string }
  | { kind: 'settings' };

const NO_SELECTION: Selection = { kind: 'none' };

const NODE_TYPES: NodeTypes = { authoredStep: AuthoredStepNode };
const EDGE_TYPES: EdgeTypes = { condition: ConditionEdge };
const DELETE_KEYS = new Set(['Backspace', 'Delete']);
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Typing in a field keeps its own undo; the canvas shortcut only acts outside one. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Edits the authored draft document on a canvas; the document stays the only state. */
export function AuthoredCanvas(props: AuthoredCanvasProps): ReactElement {
  return (
    <CanvasErrorBoundary resetKey={props.doc}>
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </CanvasErrorBoundary>
  );
}

function Canvas({
  doc,
  readOnly,
  failure = null,
  onChange,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: AuthoredCanvasProps): ReactElement {
  const projection = useMemo(() => projectDocument(doc), [doc]);
  const backEdges = useMemo(() => listBackEdges(projection.steps, projection.edges), [projection]);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const overlayRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const { deleteElements, getNodes, getEdges } = useReactFlow<
    AuthoredStepNodeType,
    ConditionEdgeType
  >();

  const selectedStep =
    selection.kind === 'step' && projection.steps.some((step) => step.step.name === selection.name)
      ? selection.name
      : null;
  const selectedEdge = selection.kind === 'edge' ? selection.id : null;

  // Stable while a step is dragged, so the memoised inspectors skip those renders.
  const write = useCallback(
    (next: AuthoredDocument): void => {
      if (readOnly) return;
      const shown = new Map(getNodes().map((node) => [node.id, node.position]));
      onChange?.(pinPositions(next, shown));
    },
    [readOnly, onChange, getNodes],
  );

  const selectStep = useCallback((name: string): void => {
    setSelection({ kind: 'step', name });
  }, []);

  const clearSelection = useCallback((): void => setSelection(NO_SELECTION), []);

  const { placed, layoutRun, relayout, movePosition } = useCanvasPlacement(projection, backEdges);
  const followRename = useCallback(
    (to: string): void => {
      if (selectedStep !== null) movePosition(selectedStep, to);
      selectStep(to);
    },
    [movePosition, selectedStep, selectStep],
  );
  const { fitCanvas, requestFocus, holdView } = useCanvasViewport({
    nodeCount: projection.steps.length,
    layoutRun,
    overlayRef,
    selected: selectedStep,
  });
  const insertion = useStepInsertion({
    doc,
    write,
    paneRef,
    selected: selectedStep,
    onInserted: selectStep,
    onDropped: (name) => {
      holdView(name);
      selectStep(name);
    },
  });

  const derivedNodes = useMemo<AuthoredStepNodeType[]>(() => {
    if (placed === null) return [];
    return projection.steps.map((step) => ({
      id: step.step.name,
      type: 'authoredStep',
      ariaLabel: `Step ${step.step.name}`,
      position: readStepPosition(step) ?? placed.get(step.step.name) ?? { x: 0, y: 0 },
      data: {
        ...step,
        hasError: step.step.name === failure?.step,
        readOnly,
        isDropTarget: step.step.name === insertion.dropTarget,
      },
      selected: step.step.name === selectedStep,
    }));
  }, [projection, placed, failure?.step, selectedStep, readOnly, insertion.dropTarget]);

  const [nodes, setNodes, onNodesChange] = useNodesState<AuthoredStepNodeType>(derivedNodes);
  // Enter or Space on a focused step selects it inside React Flow only, with no click; the inspector follows.
  const handleNodesChange = useCallback(
    (changes: NodeChange<AuthoredStepNodeType>[]): void => {
      onNodesChange(changes);
      const selected = changes.flatMap((change) =>
        change.type === 'select' && change.selected ? [change.id] : [],
      );
      if (selected.length === 1) selectStep(selected[0]);
    },
    [onNodesChange, selectStep],
  );
  // Keeps each node's measured size, since a fresh unmeasured node object is hidden until measured.
  useEffect(
    () =>
      setNodes((current) => {
        const measured = new Map(current.map((node) => [node.id, node.measured]));
        return derivedNodes.map((node) => ({ ...node, measured: measured.get(node.id) }));
      }),
    [derivedNodes, setNodes],
  );

  // Routed from the live nodes, so edges follow a step while it is dragged.
  const routes = useMemo(
    () => routeEdges(nodes, projection.edges, backEdges),
    [nodes, projection, backEdges],
  );
  // Held here because the edges are derived: React Flow can only delete an edge it sees as selected.
  const edges = useCanvasEdges({
    edges: projection.edges,
    backEdges,
    routes,
    selectedStep,
    selectedEdge,
  });

  // From the problem list: selects the step and pans to it, keeping the zoom.
  function focusStep(name: string): void {
    selectStep(name);
    requestFocus(name);
  }

  function handleConnect(connection: Connection): void {
    if (!connection.sourceHandle) return;
    const source = projection.steps.find((projected) => projected.step.name === connection.source);
    if (source?.strayPorts.includes(connection.sourceHandle)) return;
    write(connect(doc, connection.source, connection.sourceHandle, connection.target));
  }

  // A step, an edge or the empty pane, not the overlay's buttons nor the palette or inspector beside it.
  function isOnCanvas(target: EventTarget): boolean {
    if (!(target instanceof Node)) return false;
    if (target === paneRef.current?.parentElement) return true;
    return paneRef.current?.contains(target) === true && !overlayRef.current?.contains(target);
  }

  // Only the editor element handles the shortcuts, never `window`, so another page's fields keep theirs.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (readOnly || isTyping(event.target)) return;
    if (DELETE_KEYS.has(event.key) && isOnCanvas(event.target)) {
      // Through React Flow, so the deletion reaches `onDelete` with the connected edges.
      void deleteElements({
        nodes: getNodes().filter((node) => node.selected),
        edges: getEdges().filter((edge) => edge.selected),
      });
      event.preventDefault();
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) onUndo?.();
    else if (key === 'z' || key === 'y') onRedo?.();
    else return;
    event.preventDefault();
  }

  // React Flow moves the selected steps on arrow keys without a drag event; the move is written once, on release.
  function handleKeyUp(event: KeyboardEvent<HTMLDivElement>): void {
    if (readOnly || !ARROW_KEYS.has(event.key) || !isOnCanvas(event.target)) return;
    const moved = getNodes().filter((node) => node.selected);
    if (moved.length === 0) return;
    write(setPositions(doc, new Map(moved.map((node) => [node.id, node.position]))));
  }

  return (
    <div
      // Focusable, so a click on the empty canvas puts focus inside the editor and the shortcut applies.
      tabIndex={-1}
      className="flex min-h-0 flex-1 outline-none"
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {!readOnly && (
        <CanvasPalette
          onAdd={insertion.addStepOfType}
          onDragStart={insertion.startDrag}
          onDragEnd={insertion.endDrag}
        />
      )}

      <div
        ref={paneRef}
        className="relative min-h-0 flex-1"
        onDragOver={readOnly ? undefined : insertion.handleDragOver}
        onDrop={readOnly ? undefined : insertion.handleDrop}
      >
        <ReactFlow<AuthoredStepNodeType, ConditionEdgeType>
          aria-label="Workflow canvas"
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={handleNodesChange}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          edgesReconnectable={false}
          // React Flow listens on the whole document; the editor's own handler scopes the key.
          deleteKeyCode={null}
          // Every node of a multi-selection moved, not just the one under the pointer.
          onNodeDragStop={(_, __, dragged) =>
            write(setPositions(doc, new Map(dragged.map((node) => [node.id, node.position]))))
          }
          onConnect={handleConnect}
          // One write for the whole deletion: separate edge and node handlers would each start from `doc` and the later one would win.
          onDelete={({ nodes: removedNodes, edges: removedEdges }) => {
            let next = doc;
            for (const edge of removedEdges) {
              if (edge.data)
                next = disconnect(next, edge.source, edge.data.port, edge.data.armIndex);
            }
            write(removedNodes.reduce((current, node) => deleteStep(current, node.id), next));
            setSelection(NO_SELECTION);
          }}
          onNodeClick={(_, node) => selectStep(node.id)}
          onEdgeClick={
            readOnly ? undefined : (_, edge) => setSelection({ kind: 'edge', id: edge.id })
          }
          onPaneClick={clearSelection}
          snapToGrid
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          minZoom={MIN_ZOOM}
        >
          {/* One row; on a narrow pane it wraps, toolbar on top (`wrap-reverse`), so they never overlap. Wrapping in reverse flips the cross axis, so `items-end` is the top. */}
          <Panel
            ref={overlayRef}
            position="top-left"
            className="pointer-events-none right-0 flex flex-wrap-reverse items-end justify-between gap-2"
          >
            <CanvasStatus
              steps={projection.steps}
              edgeCount={projection.edges.length}
              workflowIssues={projection.workflowIssues}
              failure={failure}
              onFocusStep={focusStep}
              onOpenSettings={() => setSelection({ kind: 'settings' })}
            />
            <CanvasToolbar
              readOnly={readOnly}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={() => onUndo?.()}
              onRedo={() => onRedo?.()}
              onAutoArrange={() => {
                const layout = relayout();
                if (hasPositions(doc)) write(setPositions(doc, layout));
              }}
              onOpenSettings={() => setSelection({ kind: 'settings' })}
              onFit={() => void fitCanvas()}
            />
          </Panel>
        </ReactFlow>
        {!readOnly && projection.steps.length === 0 && (
          // Over the pane, but letting drops through to it.
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Typography variant="body-sm" className="max-w-72 text-center">
              No steps yet. Drag a step from the palette onto the canvas, or click one to add it.
            </Typography>
          </div>
        )}
      </div>

      {/* One inspector at a time. */}
      <WorkflowContentsContext.Provider value={projection.contents}>
        {selection.kind === 'settings' && (
          <WorkflowSettings
            doc={doc}
            steps={projection.steps}
            readOnly={readOnly}
            onChange={write}
            onClose={clearSelection}
          />
        )}
        {selectedStep !== null && (
          <StepPanel
            key={selectedStep}
            doc={doc}
            steps={projection.steps}
            stepName={selectedStep}
            readOnly={readOnly}
            onChange={write}
            onRenamed={followRename}
            onClose={clearSelection}
          />
        )}
      </WorkflowContentsContext.Provider>
    </div>
  );
}
