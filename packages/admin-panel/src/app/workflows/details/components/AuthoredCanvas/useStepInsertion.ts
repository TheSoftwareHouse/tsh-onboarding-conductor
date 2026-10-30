import { useState, type DragEvent } from 'react';
import { useReactFlow, type Node } from '@xyflow/react';
import { addInclude, addStep } from '../../utils/authored-edits';
import type { AuthoredDocument } from '../../utils/authored-document';
import { listIncludableTypes } from '../../utils/authored-projection';
import { HALF } from '../../utils/step-node-geometry';
import { pickSpotBelow, type Box } from '../../utils/step-placement';
import { NODE_SELECTOR } from './canvas-constants';

interface InsertionOptions {
  doc: AuthoredDocument;
  write: (doc: AuthoredDocument) => void;
  paneRef: React.RefObject<HTMLDivElement | null>;
  selected: string | null;
  /** Selects the step a click added; selecting pans to it when it is out of view. */
  onInserted: (name: string) => void;
  /** Selects the step a drop added or included into, without panning. */
  onDropped: (name: string) => void;
}

/** Adding a step from the palette, by click or by drag, and dropping a composable type onto a step. */
export function useStepInsertion({
  doc,
  write,
  paneRef,
  selected,
  onInserted,
  onDropped,
}: InsertionOptions): {
  addStepOfType: (type: string) => void;
  /** The step a dragged composable type would be included into if dropped now. */
  dropTarget: string | null;
  startDrag: (type: string) => void;
  endDrag: () => void;
  handleDragOver: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => void;
} {
  const { screenToFlowPosition, getNode, getNodes } = useReactFlow();
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Under the selected step, else mid-pane, clear of any step there; then selected.
  function addStepOfType(type: string): void {
    const pane = paneRef.current?.getBoundingClientRect();
    if (!pane) return;
    const toBox = ({ position, measured }: Node): Box => ({
      ...position,
      width: measured?.width ?? 0,
      height: measured?.height ?? 0,
    });
    const anchor = selected === null ? undefined : getNode(selected);
    const center = screenToFlowPosition({
      x: pane.left + pane.width * HALF,
      y: pane.top + pane.height * HALF,
    });
    const spot = pickSpotBelow(getNodes().map(toBox), center, anchor && toBox(anchor));
    const { doc: next, name } = addStep(doc, type, spot);
    write(next);
    onInserted(name);
  }

  /** The step under the pointer, when the dragged type can be included into it. */
  function findDropTarget(event: DragEvent): string | null {
    if (dragged === null) return null;
    const name = (event.target as Element).closest(NODE_SELECTOR)?.getAttribute('data-id');
    const step = doc.steps.find((candidate) => candidate.name === name);
    return step !== undefined && listIncludableTypes(step).includes(dragged) ? step.name : null;
  }

  function endDrag(): void {
    setDragged(null);
    setDropTarget(null);
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
    if (dragged === null) return;
    event.preventDefault();
    const target = findDropTarget(event);
    if (target !== null) {
      write(addInclude(doc, target, dragged));
      onDropped(target);
    } else {
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const { doc: next, name } = addStep(doc, dragged, position);
      write(next);
      onDropped(name);
    }
    endDrag();
  }

  return {
    addStepOfType,
    dropTarget,
    startDrag: setDragged,
    endDrag,
    handleDragOver,
    handleDrop,
  };
}
