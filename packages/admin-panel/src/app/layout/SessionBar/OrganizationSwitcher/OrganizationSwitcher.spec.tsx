import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationSwitcher } from './OrganizationSwitcher';

const { mockedUseSession, mockedUseListOrganizations, mockedSetActive, mockedErrorToast } =
  vi.hoisted(() => ({
    mockedUseSession: vi.fn(),
    mockedUseListOrganizations: vi.fn(),
    mockedSetActive: vi.fn(),
    mockedErrorToast: vi.fn(),
  }));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: {
    useSession: mockedUseSession,
    useListOrganizations: mockedUseListOrganizations,
    organization: { setActive: mockedSetActive },
  },
}));

vi.mock('@/components/ui/Toast/toast-manager', () => ({ showErrorToast: mockedErrorToast }));

// Base UI's popup does not open reliably in jsdom; a native select exercises the same props.
vi.mock('@/components/ui/Select/Select', () => ({
  Select: (props: {
    items: { value: string; label: string }[];
    value: string | null;
    onValueChange: (value: string) => void;
    'aria-label': string;
  }) => (
    <select
      aria-label={props['aria-label']}
      value={props.value ?? ''}
      onChange={(event) => props.onValueChange(event.target.value)}
    >
      {props.items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));

const ORGANIZATIONS = [
  { id: 'org-1', name: 'Alpha' },
  { id: 'org-2', name: 'Beta' },
];

function renderSwitcher() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OrganizationSwitcher />
    </QueryClientProvider>,
  );

  return { ...view, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseSession.mockReturnValue({ data: { session: { activeOrganizationId: 'org-1' } } });
  mockedUseListOrganizations.mockReturnValue({ data: ORGANIZATIONS });
  mockedSetActive.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
});

describe('OrganizationSwitcher', () => {
  it('is hidden with a single organization', () => {
    mockedUseListOrganizations.mockReturnValue({ data: [ORGANIZATIONS[0]] });

    const { container } = renderSwitcher();

    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden while the list is loading', () => {
    mockedUseListOrganizations.mockReturnValue({ data: null });

    const { container } = renderSwitcher();

    expect(container).toBeEmptyDOMElement();
  });

  it('lists the organizations with the active one selected', () => {
    renderSwitcher();

    expect(screen.getByRole('combobox', { name: 'Organization' })).toHaveValue('org-1');
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
  });

  it('switches the active organization and drops the cached reads', async () => {
    const { invalidate } = renderSwitcher();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organization' }), 'org-2');

    await waitFor(() => expect(mockedSetActive).toHaveBeenCalledWith({ organizationId: 'org-2' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  });

  it('reports a refused switch and keeps the cache', async () => {
    mockedSetActive.mockResolvedValue({ data: null, error: { message: 'Not a member' } });
    const { invalidate } = renderSwitcher();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organization' }), 'org-2');

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith('Organization not switched', 'Not a member'),
    );
    expect(invalidate).not.toHaveBeenCalled();
  });
});
