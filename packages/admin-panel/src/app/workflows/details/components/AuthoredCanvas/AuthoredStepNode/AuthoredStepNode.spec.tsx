import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthoredDocument } from '../../../utils/authored-document';
import { projectDocument } from '../../../utils/authored-projection';
import { listSlots } from '../../../utils/step-node-geometry';
import {
  AuthoredStepNode,
  type AuthoredStepNodeData,
  type AuthoredStepNodeType,
} from './AuthoredStepNode';

const NODE_TYPES = { authoredStep: AuthoredStepNode };

const DOC: AuthoredDocument = {
  initial: 'check',
  steps: [
    {
      name: 'check',
      type: 'decision',
      config: { branches: [{ port: 'yes', when: { field: 'x', isSet: true } }], fallback: true },
      edges: { yes: 'check', default: 'check' },
    },
    { name: 'broken', type: 'form', config: {}, edges: {} },
    {
      name: 'custom_scored',
      type: 'custom',
      config: { scoring: [{ score: 'trust', add: 2 }], transitions: [] },
    },
    {
      name: 'scored',
      type: 'form',
      config: {},
      edges: {},
      scoring: [
        { score: 'risk', add: 5 },
        { score: 'trust', add: -2 },
        { score: 'risk', add: 1 },
      ],
    },
  ],
};

afterEach(cleanup);

function renderNode(name: string, overrides: Partial<AuthoredStepNodeData> = {}): HTMLElement {
  const projected = projectDocument(DOC).steps.find((step) => step.step.name === name)!;
  const data: AuthoredStepNodeData = {
    ...projected,
    hasError: false,
    readOnly: false,
    isDropTarget: false,
    ...overrides,
  };
  const nodes: AuthoredStepNodeType[] = [
    { id: name, type: 'authoredStep', position: { x: 0, y: 0 }, data },
  ];
  const { container } = render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={nodes} nodeTypes={NODE_TYPES} />
      </div>
    </ReactFlowProvider>,
  );
  return container;
}

describe('AuthoredStepNode', () => {
  it('lists each score its rules touch once, and nothing for a step with no rules', () => {
    renderNode('scored');

    expect(screen.getByText('scores: risk, trust')).toBeTruthy();

    cleanup();
    renderNode('custom_scored');

    expect(screen.getByText('scores: trust')).toBeTruthy();

    cleanup();
    renderNode('broken');

    expect(screen.queryByText(/^scores:/)).toBeNull();
  });

  it('shows the step name, its type, the category and the start marker', () => {
    renderNode('check');

    expect(screen.getByText('check')).toBeTruthy();
    expect(screen.getByText('decision')).toBeTruthy();
    expect(screen.getByText('decide')).toBeTruthy();
    expect(screen.getByText('start')).toBeTruthy();
  });

  it('draws a labelled port and a source handle for each one', () => {
    const container = renderNode('check');
    const slots = listSlots(projectDocument(DOC).steps[0]!);

    expect(slots.length).toBeGreaterThan(1);
    for (const slot of slots) {
      expect(screen.getByText(slot.label)).toBeTruthy();
      expect(container.querySelector(`.source[data-handleid="${slot.name}"]`)).not.toBeNull();
    }
    expect(container.querySelectorAll('.target')).toHaveLength(1);
  });

  it('marks a step with problems', () => {
    renderNode('broken');

    expect(screen.getByText(/⚠/)).toBeTruthy();
  });

  it('marks a step the last Validate failed on', () => {
    renderNode('check', { hasError: true });

    expect(screen.getByText(/the last Validate failed here/)).toBeTruthy();
  });

  it('shows no problem marker on a clean step', () => {
    renderNode('check');

    expect(screen.queryByText(/⚠/)).toBeNull();
  });
});
