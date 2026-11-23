import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ReactFlowProps } from '@xyflow/react';
import type { AuthoredDocument } from '../../utils/authored-document';
import { AuthoredCanvas, type AuthoredCanvasProps } from './AuthoredCanvas';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';

const flow = vi.hoisted(() => ({
  onConnect: undefined as ((connection: Connection) => void) | undefined,
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlow: (props: ReactFlowProps) => {
      flow.onConnect = props.onConnect;
      return <actual.ReactFlow {...props} />;
    },
  };
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const formConfig = (field: string): Record<string, unknown> => ({
  fields: { [field]: { type: 'text', required: true } },
});

const DOC: AuthoredDocument = {
  initial: 'collect',
  steps: [
    {
      name: 'collect',
      type: 'form',
      config: formConfig('first'),
      edges: { success: 'done' },
      meta: { position: { x: 0, y: 0 } },
    },
    {
      name: 'broken',
      type: 'form',
      config: formConfig('second'),
      meta: { position: { x: 400, y: 0 } },
    },
    { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
  ],
};

const STRAY: AuthoredDocument = {
  initial: 'collect',
  steps: [
    {
      name: 'collect',
      type: 'form',
      config: formConfig('first'),
      edges: { success: 'done', gone: 'done' },
    },
    { name: 'other', type: 'form', config: formConfig('second') },
    { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
  ],
};

const EMPTY: AuthoredDocument = { steps: [] };

/** Holds the document the way the draft editor does, so a sequence of edits accumulates. */
function Harness({
  initial = DOC,
  onChange,
  ...props
}: Partial<Omit<AuthoredCanvasProps, 'doc'>> & {
  initial?: AuthoredDocument;
  onChange?: (doc: AuthoredDocument) => void;
}): ReactElement {
  const [doc, setDoc] = useState(initial);
  return (
    <>
      <input aria-label="Outside" />
      <AuthoredCanvas
        doc={doc}
        readOnly={false}
        {...props}
        onChange={(next) => {
          setDoc(next);
          onChange?.(next);
        }}
      />
    </>
  );
}

const lastDoc = (onChange: ReturnType<typeof vi.fn>): AuthoredDocument =>
  onChange.mock.calls.at(-1)![0] as AuthoredDocument;

describe('AuthoredCanvas connections', () => {
  it('connects from a real port and ignores a stray one', () => {
    const onChange = vi.fn();
    render(<Harness initial={STRAY} onChange={onChange} />);

    flow.onConnect!({
      source: 'collect',
      sourceHandle: 'gone',
      target: 'other',
      targetHandle: null,
    });
    expect(onChange).not.toHaveBeenCalled();

    flow.onConnect!({
      source: 'collect',
      sourceHandle: 'success',
      target: 'other',
      targetHandle: null,
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('CanvasErrorBoundary', () => {
  function Boom(): never {
    throw new Error('cannot project');
  }

  it('blanks the canvas with the reason, and retries when the key changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <CanvasErrorBoundary resetKey="a">
        <Boom />
      </CanvasErrorBoundary>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'The canvas cannot draw this document: cannot project. Fix it in the JSON tab.',
    );

    rerender(
      <CanvasErrorBoundary resetKey="b">
        <p>drawn</p>
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText('drawn')).toBeInTheDocument();
  });
});

describe('AuthoredCanvas', () => {
  it('shows the empty state on an empty draft, and not in read-only mode', () => {
    render(<Harness initial={EMPTY} />);
    expect(
      screen.getByText(
        'No steps yet. Drag a step from the palette onto the canvas, or click one to add it.',
      ),
    ).toBeInTheDocument();

    cleanup();
    render(<AuthoredCanvas doc={EMPTY} readOnly />);
    expect(screen.queryByText(/No steps yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('adds a step to the document when a palette item is clicked', async () => {
    const onChange = vi.fn();
    render(<Harness initial={EMPTY} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /^terminal/ }));

    const next = lastDoc(onChange);
    expect(next.steps).toHaveLength(1);
    expect(next.steps[0]).toMatchObject({ name: 'terminal_1', type: 'terminal' });
    expect(screen.queryByText(/No steps yet/)).not.toBeInTheDocument();
    // The new step is selected, so its inspector opens.
    expect(screen.getByRole('textbox', { name: 'Step name' })).toHaveValue('terminal_1');
  });

  it('lists one button per problem step, and clicking one selects that step', async () => {
    render(<Harness />);

    expect(screen.getByText(/1 step with problems/)).toBeInTheDocument();
    const problems = screen.getAllByRole('button', { name: /^(collect|broken|done):/ });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toHaveTextContent('broken');

    await userEvent.click(problems[0]!);
    expect(screen.getByRole('textbox', { name: 'Step name' })).toHaveValue('broken');
  });

  it('opens the inspector of a step focused and selected with Enter', async () => {
    render(<Harness />);

    fireEvent.keyDown(await screen.findByLabelText('Step collect'), { key: 'Enter' });

    expect(await screen.findByRole('textbox', { name: 'Step name' })).toHaveValue('collect');
  });

  it('writes an arrow-key move of the selected step once the key is released', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const node = await screen.findByLabelText('Step collect');
    fireEvent.keyDown(node, { key: 'Enter' });

    fireEvent.keyDown(node, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyUp(node, { key: 'ArrowRight' });

    const moved = lastDoc(onChange).steps.find((step) => step.name === 'collect');
    expect(moved?.meta?.position).toMatchObject({ y: 0 });
    expect(moved?.meta?.position).not.toEqual({ x: 0, y: 0 });
  });

  it('pluralises the step and edge counts', () => {
    const one: AuthoredDocument = {
      initial: 'collect',
      steps: [
        { name: 'collect', type: 'form', config: formConfig('first'), edges: { success: 'done' } },
        { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
      ],
    };
    render(<AuthoredCanvas doc={one} readOnly />);
    expect(screen.getByText('2 steps · 1 edge')).toBeInTheDocument();

    cleanup();
    render(<AuthoredCanvas doc={{ steps: [one.steps[1]!] }} readOnly />);
    expect(screen.getByText('1 step · 0 edges')).toBeInTheDocument();
  });

  it('says so when no step has a problem', () => {
    const fixed: AuthoredDocument = {
      initial: 'collect',
      steps: [
        { name: 'collect', type: 'form', config: formConfig('first'), edges: { success: 'done' } },
        { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
      ],
    };
    render(<AuthoredCanvas doc={fixed} readOnly />);

    expect(screen.getByText('No problems found on the canvas')).toBeInTheDocument();
  });

  it('names the last Validate failure, with a button to its step', async () => {
    render(
      <AuthoredCanvas
        doc={DOC}
        readOnly={false}
        onChange={vi.fn()}
        failure={{ reason: 'port is not wired', path: 'steps[1].edges', step: 'broken' }}
      />,
    );

    expect(screen.getByText(/Last Validate: port is not wired/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'broken' }));
    expect(screen.getByRole('textbox', { name: 'Step name' })).toHaveValue('broken');
  });

  it('writes the new layout to every step when Auto-arrange is clicked on a placed draft', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Auto-arrange' }));

    expect(lastDoc(onChange).steps.every((step) => step.meta?.position !== undefined)).toBe(true);
  });

  it('leaves a draft without positions untouched when Auto-arrange is clicked', async () => {
    const onChange = vi.fn();
    const unplaced: AuthoredDocument = {
      steps: DOC.steps.map((step) => ({ ...step, meta: undefined })),
    };
    render(<Harness initial={unplaced} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Auto-arrange' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('undoes and redoes on Cmd/Ctrl+Z inside the editor, and does nothing outside it', async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<Harness onUndo={onUndo} onRedo={onRedo} canUndo canRedo />);
    const inside = screen.getByRole('button', { name: 'Auto-arrange' });

    fireEvent.keyDown(screen.getByLabelText('Outside'), { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(onUndo).not.toHaveBeenCalled();

    fireEvent.keyDown(inside, { key: 'z', ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(inside, { key: 'z', metaKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);

    // A field inside the editor keeps its own undo.
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'z', ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('runs Undo and Redo from the toolbar', async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<Harness onUndo={onUndo} onRedo={onRedo} canUndo canRedo={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('opens the workflow settings from the toolbar', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'Workflow settings' }));

    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });
});
