import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DefinitionList, type DefinitionListEntry } from './DefinitionList';

afterEach(() => {
  cleanup();
});

const ENTRIES: DefinitionListEntry[] = [
  { key: 'risk', term: 'risk', description: '42/100' },
  { key: 'trust', term: 'trust', description: '18/100' },
];

describe('DefinitionList', () => {
  it('renders each entry as a dt/dd pair, in order', () => {
    render(<DefinitionList entries={ENTRIES} />);

    expect(screen.getByText('risk').tagName).toBe('DT');
    expect(screen.getByText('42/100').tagName).toBe('DD');
    expect(screen.getByText('trust').tagName).toBe('DT');
    expect(screen.getByText('18/100').tagName).toBe('DD');
  });

  it('carries no top rule on the first pair', () => {
    render(<DefinitionList entries={ENTRIES} />);

    expect(screen.getByText('risk')).not.toHaveClass('border-t');
    expect(screen.getByText('42/100')).not.toHaveClass('border-t');
  });

  it('rules every pair after the first', () => {
    render(<DefinitionList entries={ENTRIES} />);

    expect(screen.getByText('trust')).toHaveClass('border-t', 'border-border-hair');
    expect(screen.getByText('18/100')).toHaveClass('border-t', 'border-border-hair');
  });

  it('renders the plain term variant at body-sm/fg-4, the Collected-data flavour', () => {
    render(<DefinitionList entries={ENTRIES} termVariant="plain" />);

    const dt = screen.getByText('risk');

    expect(dt).toHaveClass('text-body-sm', 'text-fg-4');
    expect(dt).not.toHaveClass('font-mono', 'text-fg-3');
  });

  it('renders the mono term variant at mono/fg-3, the Scores flavour', () => {
    render(<DefinitionList entries={ENTRIES} termVariant="mono" />);

    const dt = screen.getByText('risk');

    expect(dt).toHaveClass('font-mono', 'text-mono', 'text-fg-3');
    expect(dt).not.toHaveClass('text-fg-2');
  });

  it('gives the key column a 200px minimum', () => {
    const { container } = render(<DefinitionList entries={ENTRIES} />);

    expect(container.querySelector('dl')).toHaveClass(
      'grid-cols-[minmax(200px,max-content)_minmax(0,1fr)]',
    );
  });
});
