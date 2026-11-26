import { useMemo, type ReactElement } from 'react';
import { ErrorState } from '@/components/ui/ErrorState/ErrorState';
import { CANVAS_ERROR_TITLE } from '../../constants/canvas-error';
import { describeCanvasError } from '../../utils/describe-canvas-error';
import { JSON_INDENT } from '../../constants/json-indent';
import { parseDocument } from '../../utils/authored-document';
import { AuthoredCanvas } from '../AuthoredCanvas/AuthoredCanvas';
import type { CanvasFailure } from '../AuthoredCanvas/CanvasStatus';

export interface DraftCanvasProps {
  /** The editor's text, shared with the JSON tab. */
  text: string;
  failure: CanvasFailure | null;
  /** Every canvas edit hands over the whole next text. */
  onChange: (text: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** The draft's canvas over the editor's text; text that is not a document leaves a prompt to fix it. */
export function DraftCanvas({
  text,
  failure,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: DraftCanvasProps): ReactElement {
  const doc = useMemo(() => parseDocument(text), [text]);

  if (typeof doc === 'string') {
    return <ErrorState title={CANVAS_ERROR_TITLE} body={describeCanvasError(doc)} />;
  }

  return (
    <AuthoredCanvas
      doc={doc}
      readOnly={false}
      failure={failure}
      onChange={(next) => onChange(JSON.stringify(next, null, JSON_INDENT))}
      onUndo={onUndo}
      onRedo={onRedo}
      canUndo={canUndo}
      canRedo={canRedo}
    />
  );
}
