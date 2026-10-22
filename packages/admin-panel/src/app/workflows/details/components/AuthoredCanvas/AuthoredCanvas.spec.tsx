import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoredCanvas } from './AuthoredCanvas';

const NULL_PORT_DOCUMENT = JSON.stringify({
  id: 'poc',
  version: 1,
  initial: 'collect',
  steps: [{ name: 'collect', type: 'form', edges: { success: null } }],
});

describe('AuthoredCanvas', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the error in place of the canvas when the document cannot be projected', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<AuthoredCanvas text={NULL_PORT_DOCUMENT} errorPath={null} errorReason={null} />);

    expect(screen.getByText(/The canvas cannot draw this document/)).toBeInTheDocument();
  });

  it('retries once the text changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <AuthoredCanvas text={NULL_PORT_DOCUMENT} errorPath={null} errorReason={null} />,
    );

    rerender(<AuthoredCanvas text="{" errorPath={null} errorReason={null} />);

    expect(screen.queryByText(/The canvas cannot draw this document/)).not.toBeInTheDocument();
    expect(screen.getByText(/Canvas needs valid JSON/)).toBeInTheDocument();
  });
});
