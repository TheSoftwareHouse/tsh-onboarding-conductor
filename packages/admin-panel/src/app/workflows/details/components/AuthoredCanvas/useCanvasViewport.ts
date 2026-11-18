import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useNodesInitialized, useReactFlow, useStore } from '@xyflow/react';
import { BASE_NODE_HEIGHT, HALF, MIN_NODE_WIDTH } from '../../utils/step-node-geometry';
import { isBoxVisible } from '../../utils/viewport-visibility';
import type { AuthoredStepNodeType } from './AuthoredStepNode/AuthoredStepNode';
import {
  FIT_MAX_ZOOM,
  FIT_SIDE_PADDING,
  OPEN_MIN_ZOOM,
  PAN_DURATION_MS,
  START_STEP_MARGIN,
  VISIBLE_MARGIN,
} from './canvas-constants';

interface ViewportOptions {
  nodeCount: number;
  layoutRun: number;
  /** The row floating along the canvas's top, which a fit keeps the graph below. */
  overlayRef: RefObject<HTMLDivElement | null>;
  selected: string | null;
}

/** Opening fit, fit on demand, and panning to a step; call inside a `ReactFlowProvider`. */
export function useCanvasViewport({
  nodeCount,
  layoutRun,
  overlayRef,
  selected,
}: ViewportOptions): {
  fitCanvas: (minZoom?: number) => Promise<boolean>;
  requestFocus: (name: string) => void;
  holdView: (name: string) => void;
} {
  const { fitView, getNode, getNodes, getViewport, setViewport, setCenter } =
    useReactFlow<AuthoredStepNodeType>();
  const nodesInitialized = useNodesInitialized();
  const [fittedRun, setFittedRun] = useState(0);
  // A new object per request, so asking for the same step twice pans again.
  const [focusRequest, setFocusRequest] = useState<{ name: string } | null>(null);
  // The step a drop selected; it never pans while it stays selected.
  const heldRef = useRef<string | null>(null);
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  // A step added this render is not in React Flow's store yet; the pan waits for it to be measured.
  const selectedMeasured = useStore(
    (state) => selected !== null && state.nodeLookup.get(selected)?.measured.width !== undefined,
  );

  // Screen pixels the floating row takes at the top, which a fit keeps the graph below.
  const measureClearance = useCallback(
    (): number => (overlayRef.current?.offsetHeight ?? 0) + START_STEP_MARGIN,
    [overlayRef],
  );

  const fitCanvas = useCallback(
    (minZoom?: number) =>
      fitView({
        padding: { top: `${measureClearance()}px`, x: FIT_SIDE_PADDING, bottom: FIT_SIDE_PADDING },
        minZoom,
        maxZoom: FIT_MAX_ZOOM,
      }),
    [fitView, measureClearance],
  );

  // Fit, then, when the zoom floor crops the top, pan down until the start step sits below the overlays.
  useEffect(() => {
    if (!nodesInitialized || nodeCount === 0 || fittedRun === layoutRun) return;
    setFittedRun(layoutRun);
    void fitCanvas(OPEN_MIN_ZOOM).then(() => {
      const start = getNodes().find((node) => node.data.isInitial);
      if (start === undefined) return;
      const { x, y, zoom } = getViewport();
      const top = start.position.y * zoom + y;
      const clearance = measureClearance();
      if (top < clearance) void setViewport({ x, y: y + clearance - top, zoom });
    });
  }, [
    nodesInitialized,
    nodeCount,
    fittedRun,
    layoutRun,
    fitCanvas,
    measureClearance,
    getNodes,
    getViewport,
    setViewport,
  ]);

  // Centres on request and when selecting a step left it out of view; the operator's own pan stands.
  useEffect(() => {
    if (heldRef.current !== selected) heldRef.current = null;
    // A request is spent once the selection moves on, so it cannot override a later drop's hold.
    if (focusRequest !== null && focusRequest.name !== selected) setFocusRequest(null);
    if (selected === null) return;
    const node = getNode(selected);
    if (node === undefined) return;
    const box = {
      ...node.position,
      width: node.measured?.width ?? MIN_NODE_WIDTH,
      height: node.measured?.height ?? BASE_NODE_HEIGHT,
    };
    const asked = focusRequest?.name === selected;
    if (!asked && heldRef.current === selected) return;
    const pane = { width: paneWidth, height: paneHeight };
    if (!asked && isBoxVisible(box, getViewport(), pane, VISIBLE_MARGIN)) return;
    void setCenter(box.x + box.width * HALF, box.y + box.height * HALF, {
      zoom: getViewport().zoom,
      duration: PAN_DURATION_MS,
    });
  }, [
    focusRequest,
    selected,
    selectedMeasured,
    paneWidth,
    paneHeight,
    nodeCount,
    getNode,
    getViewport,
    setCenter,
  ]);

  const requestFocus = useCallback((name: string) => setFocusRequest({ name }), []);
  const holdView = useCallback((name: string) => {
    heldRef.current = name;
  }, []);

  return { fitCanvas, requestFocus, holdView };
}
