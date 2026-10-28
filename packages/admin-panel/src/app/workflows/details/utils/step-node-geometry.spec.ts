import { describe, expect, it } from 'vitest';
import type { AuthoredDocument } from './authored-document';
import { GRID_SIZE } from './authored-edits';
import { projectDocument } from './authored-projection';
import {
  BASE_NODE_HEIGHT,
  listPortCenters,
  listSlots,
  MIN_NODE_WIDTH,
  nodeHeight,
  nodeWidth,
} from './step-node-geometry';

const DOC: AuthoredDocument = {
  initial: 'start',
  steps: [
    {
      name: 'start',
      type: 'decision',
      config: { branches: [{ port: 'yes', when: { field: 'x', isSet: true } }], fallback: true },
      edges: { yes: 'tall', default: 'tall' },
    },
    {
      name: 'tall',
      type: 'form',
      config: { fields: { tall_value: { type: 'text', required: true } } },
      include: [
        { type: 'consents', config: { consents: [{ key: 'terms', acknowledgement: 'accepted' }] } },
      ],
    },
  ],
};

function project(name: string) {
  return projectDocument(DOC).steps.find((step) => step.step.name === name)!;
}

describe('step node geometry', () => {
  it('reuses the slots of the same step and rebuilds them for a changed one', () => {
    const step = project('start');
    const stray = projectDocument({
      steps: [
        { ...DOC.steps[0]!, edges: { yes: 'tall', default: 'tall', gone: 'tall' } },
        DOC.steps[1]!,
      ],
    }).steps[0]!;

    expect(listSlots(step)).toBe(listSlots(step));
    expect(listSlots(stray).map((slot) => slot.name)).toContain('gone');
    expect(listSlots(step).map((slot) => slot.name)).not.toContain('gone');
  });

  it('rounds a node’s width up to whole pairs of grid cells, never under the minimum', () => {
    const width = nodeWidth(project('start'));

    expect(width).toBeGreaterThanOrEqual(MIN_NODE_WIDTH);
    expect(width % (GRID_SIZE * 2)).toBe(0);
  });

  it('adds a line for the included sections and one for an issue', () => {
    const plain = project('start');
    const withIncludes = project('tall');

    expect(nodeHeight(plain)).toBe(
      BASE_NODE_HEIGHT + (plain.issues.length > 0 ? GRID_SIZE * 2 : 0),
    );
    expect(nodeHeight(withIncludes)).toBeGreaterThan(nodeHeight(plain));
    expect(nodeHeight({ ...plain, hasError: true })).toBeGreaterThan(
      nodeHeight({ ...plain, issues: [] }),
    );
  });

  it('adds a line for the scores a step contributes to', () => {
    const plain = project('start');
    const scored = {
      ...plain,
      step: { ...plain.step, scoring: [{ score: 'risk', add: 1 }] },
    };

    expect(nodeHeight(scored)).toBe(nodeHeight(plain) + GRID_SIZE * 2);
  });

  it('adds the same line for a custom step’s config.scoring', () => {
    const plain = project('start');
    const scored = {
      ...plain,
      step: {
        ...plain.step,
        type: 'custom',
        config: { scoring: [{ score: 'risk', add: 1 }], transitions: [] },
      },
    };

    expect(nodeHeight(scored)).toBe(nodeHeight(plain) + GRID_SIZE * 2);
  });

  it('places one handle per port on the grid, in order, inside the node', () => {
    const step = project('start');
    const centers = listPortCenters(step);

    expect(centers.map((center) => center.name)).toEqual(
      step.ports.kind === 'known' ? step.ports.ports.map((port) => port.name) : [],
    );
    expect(centers.length).toBeGreaterThan(1);
    for (const center of centers) {
      expect(center.x % GRID_SIZE).toBe(0);
      expect(center.x).toBeGreaterThan(0);
      expect(center.x).toBeLessThan(nodeWidth(step));
    }
    expect(centers.map((center) => center.x)).toEqual(
      [...centers.map((c) => c.x)].sort((a, b) => a - b),
    );
  });
});
