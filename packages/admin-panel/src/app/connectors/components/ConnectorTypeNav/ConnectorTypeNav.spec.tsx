import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectorCardProps } from '../ConnectorList/ConnectorCard/ConnectorCard';
import type { ConnectorTypeGroup } from '../ConnectorList/group-connectors-by-type';
import { ConnectorTypeNav } from './ConnectorTypeNav';

function group(type: string, label: string, cardCount: number): ConnectorTypeGroup {
  return {
    type,
    label,
    cards: Array.from({ length: cardCount }, () => ({}) as ConnectorCardProps),
  };
}

afterEach(() => {
  cleanup();
});

describe('ConnectorTypeNav', () => {
  it('renders one tab per populated group with its adapter count', () => {
    render(
      <MemoryRouter>
        <ConnectorTypeNav
          groups={[group('kyc', 'Identity verification', 2), group('custom', 'Custom', 1)]}
          notImplemented={[]}
          selectedType="kyc"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Identity verification 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Custom 1' })).toBeInTheDocument();
  });

  it('marks exactly the selected type as current', () => {
    render(
      <MemoryRouter>
        <ConnectorTypeNav
          groups={[group('kyc', 'Identity verification', 2), group('custom', 'Custom', 1)]}
          notImplemented={[]}
          selectedType="kyc"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Identity verification 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Custom 1' })).not.toHaveAttribute('aria-current');
  });

  it('carries a `?type=` href per tab', () => {
    render(
      <MemoryRouter>
        <ConnectorTypeNav
          groups={[group('kyc', 'Identity verification', 2)]}
          notImplemented={[]}
          selectedType="kyc"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Identity verification 2' })).toHaveAttribute(
      'href',
      '/connectors?type=kyc',
    );
  });

  it('lists the not-implemented types as read-only notes, labelled', () => {
    render(
      <MemoryRouter>
        <ConnectorTypeNav
          groups={[group('kyc', 'Identity verification', 2)]}
          notImplemented={['kyb', 'aml']}
          selectedType="kyc"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Business verification')).toBeInTheDocument();
    expect(screen.getByText('Sanctions screening')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Business verification' })).not.toBeInTheDocument();
  });

  it('omits the Not implemented group entirely when every type is populated', () => {
    render(
      <MemoryRouter>
        <ConnectorTypeNav
          groups={[group('kyc', 'Identity verification', 2)]}
          notImplemented={[]}
          selectedType="kyc"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Not implemented')).not.toBeInTheDocument();
  });
});
