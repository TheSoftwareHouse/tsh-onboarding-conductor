import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Redo, Undo } from '@/components/ui/icons';
import { WorkflowZoomControls } from '../WorkflowGraph/WorkflowZoomControls';

export interface CanvasToolbarProps {
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAutoArrange: () => void;
  onOpenSettings: () => void;
  onFit: () => void;
}

/** Undo, Redo, Auto-arrange and Workflow settings, then the zoom controls. */
export function CanvasToolbar({
  readOnly,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAutoArrange,
  onOpenSettings,
  onFit,
}: CanvasToolbarProps): ReactElement {
  return (
    // `ml-auto` keeps it right when it has a line to itself.
    <div className="pointer-events-auto ml-auto flex flex-wrap items-center justify-end gap-2">
      <div className="flex items-center gap-2 border border-border-rule bg-bg-page px-3 py-2">
        {!readOnly && (
          <>
            <Button
              variant="outline"
              size="md"
              aria-label="Undo"
              title="Undo (⌘Z / Ctrl+Z)"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Undo aria-hidden className="size-5" />
            </Button>
            <Button
              variant="outline"
              size="md"
              aria-label="Redo"
              title="Redo (⇧⌘Z / Ctrl+Y)"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <Redo aria-hidden className="size-5" />
            </Button>
            <Button
              variant="outline"
              size="md"
              title="Lay the steps out again, dropping the positions you set"
              onClick={onAutoArrange}
            >
              Auto-arrange
            </Button>
          </>
        )}
        <Button variant="outline" size="md" onClick={onOpenSettings}>
          Workflow settings
        </Button>
      </div>
      <WorkflowZoomControls onFit={onFit} />
    </div>
  );
}
