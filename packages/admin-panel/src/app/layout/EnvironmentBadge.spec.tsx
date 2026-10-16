import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EnvironmentBadge } from './EnvironmentBadge';

afterEach(() => {
  cleanup();
  delete window.__ENV__;
});

describe('EnvironmentBadge', () => {
  it('names a non-production environment', () => {
    window.__ENV__ = { VITE_ENVIRONMENT_NAME: 'staging', VITE_NODE_ENV: 'development' };
    render(<EnvironmentBadge />);

    expect(screen.getByText('staging')).toHaveAttribute('title', 'Development');
  });

  it('marks a production engine whatever its environment is called', () => {
    window.__ENV__ = { VITE_ENVIRONMENT_NAME: 'pre-prod', VITE_NODE_ENV: 'production' };
    render(<EnvironmentBadge />);

    expect(screen.getByText('pre-prod')).toHaveAttribute('title', 'Production');
  });

  it('renders nothing when the engine reported no environment', () => {
    const { container } = render(<EnvironmentBadge />);

    expect(container).toBeEmptyDOMElement();
  });
});
