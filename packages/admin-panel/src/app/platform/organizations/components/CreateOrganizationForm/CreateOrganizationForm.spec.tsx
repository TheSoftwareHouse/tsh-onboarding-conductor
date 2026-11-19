import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrganization } from '@/api/platform/platform';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { CreateOrganizationForm } from './CreateOrganizationForm';

vi.mock('@/api/platform/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/platform/platform')>()),
  createOrganization: vi.fn(),
}));

const { mockedSuccessToast, mockedErrorToast } = vi.hoisted(() => ({
  mockedSuccessToast: vi.fn(),
  mockedErrorToast: vi.fn(),
}));

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: mockedSuccessToast,
  showErrorToast: mockedErrorToast,
}));

function renderForm() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <CreateOrganizationForm />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createOrganization).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe('CreateOrganizationForm', () => {
  it('creates the organization, reports it and clears the form', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Name/), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => expect(createOrganization).toHaveBeenCalledWith('Acme'));
    await waitFor(() =>
      expect(mockedSuccessToast).toHaveBeenCalledWith('Organization Acme created'),
    );
    await waitFor(() => expect(screen.getByLabelText(/^Name/)).toHaveValue(''));
  });

  it('rejects an empty name and a name without a letter or digit', async () => {
    renderForm();

    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^Name/), '---');
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText('Use at least one letter or digit.')).toBeInTheDocument();
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it('reports a refusal and keeps the input', async () => {
    vi.mocked(createOrganization).mockRejectedValue(new Error('Slug taken'));
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Name/), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith('Organization not created', 'Slug taken'),
    );
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Acme');
  });
});
