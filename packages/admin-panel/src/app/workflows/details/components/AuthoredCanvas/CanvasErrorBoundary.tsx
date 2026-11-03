import { Component, type ReactNode } from 'react';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';

interface CanvasErrorBoundaryProps {
  /** Changing it retries the canvas, so an edit that fixes the document brings it back. */
  resetKey: unknown;
  children: ReactNode;
}

interface CanvasErrorBoundaryState {
  error: Error | null;
  resetKey: unknown;
}

/** A document the projection cannot read blanks only the canvas. */
export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<CanvasErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: CanvasErrorBoundaryProps,
    state: CanvasErrorBoundaryState,
  ): Partial<CanvasErrorBoundaryState> | null {
    return Object.is(props.resetKey, state.resetKey)
      ? null
      : { error: null, resetKey: props.resetKey };
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
