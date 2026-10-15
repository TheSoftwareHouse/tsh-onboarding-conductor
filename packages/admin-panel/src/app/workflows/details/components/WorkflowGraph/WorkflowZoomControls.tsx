import type { ReactElement } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { Button } from '@/components/ui/Button/Button';
import { Typography } from '@/components/ui/Typography/Typography';

/** 13.33px is the browser's default button text size, which the design's unstyled − and + keep. */
const STEP_BUTTON = 'w-8 px-1.5 py-px text-[13.33px] font-normal tracking-normal';

const PERCENT = 100;

/** Share of the canvas Fit leaves empty around the graph. */
const FIT_PADDING = 0.1;

/** Zoom out, the current zoom, zoom in and fit-to-view, floating on the graph's canvas. */
export function WorkflowZoomControls(): ReactElement {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();

  return (
    <div className="flex items-center gap-2 border border-border-rule bg-tsh-white px-3 py-2 **:leading-natural">
      <Typography variant="caps-tiny" className="text-fg-3">
        Zoom
      </Typography>
      <Button
        size="md"
        className={STEP_BUTTON}
        aria-label="Zoom out"
        onClick={() => void zoomOut()}
      >
        −
      </Button>
      <Typography
        variant="mono"
        className="min-w-8 text-center text-tsh-black tabular-nums"
        aria-live="off"
      >
        {Math.round(zoom * PERCENT)}%
      </Typography>
      <Button size="md" className={STEP_BUTTON} aria-label="Zoom in" onClick={() => void zoomIn()}>
        +
      </Button>
      <Button
        size="md"
        className="font-normal tracking-normal text-fg-3"
        onClick={() => void fitView({ padding: FIT_PADDING, duration: 0 })}
      >
        Fit
      </Button>
    </div>
  );
}
