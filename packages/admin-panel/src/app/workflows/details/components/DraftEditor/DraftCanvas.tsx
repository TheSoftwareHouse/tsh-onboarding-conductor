import { useMemo, type ReactElement } from 'react';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
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
    return (
      <StatusRegion className="px-8 py-6">{`Fix the JSON to see the canvas: ${doc}`}</StatusRegion>
    );
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
