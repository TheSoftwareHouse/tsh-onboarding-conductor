import { Component, type ReactNode } from 'react';
import { ErrorState } from '@/components/ui/ErrorState/ErrorState';
import { CANVAS_ERROR_TITLE } from '../../constants/canvas-error';
import { describeCanvasError } from '../../utils/describe-canvas-error';

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
      <ErrorState title={CANVAS_ERROR_TITLE} body={describeCanvasError(this.state.error.message)} />
    );
  }
}
